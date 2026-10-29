import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createEdChestPainLocalLearnerRuntimeAssetBundle } from "@openclinxr/asset-registry/runtime-bundles";
import { describe, expect, it } from "vitest";
import {
  buildGeneratedEdStationRuntimeBundleReport,
  refreshPublicActorPlacements,
  refreshPublicEquipment,
  refreshPublicEquipmentInLearnerBundle,
  runGeneratedEdStationRuntimeBundleCli,
  validateGeneratedEdStationRuntimeBundleReport,
} from "./generated-ed-station-runtime-bundle.js";

describe("generated ED station runtime bundle", () => {
  it("retains the standing authored vector needed to name the runtime floor frame", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-public-placement-refresh-"));
    const scenarioId = "primary_care_dyslipidemia_joint_pain_v1";
    const stationDir = path.join(tempDir, scenarioId);
    try {
      await mkdir(stationDir, { recursive: true });
      const bundle = { sceneManifest: { actorPlacements: {} } };
      await writeFile(path.join(stationDir, "learner-runtime-bundle.v1.json"), JSON.stringify(bundle), "utf8");
      await writeFile(path.join(stationDir, "scene-manifest.v1.json"), JSON.stringify({ actorPlacements: {} }), "utf8");

      await refreshPublicActorPlacements(scenarioId, tempDir);

      const refreshed = JSON.parse(await readFile(path.join(stationDir, "learner-runtime-bundle.v1.json"), "utf8")) as {
        sceneManifest: { actorPlacements: Record<string, { posture?: string; position?: unknown; plantOffsetMeters?: unknown }> };
      };
      const placement = refreshed.sceneManifest.actorPlacements["medical_assistant_jones_v1"];
      expect(placement).toMatchObject({
        posture: "standing",
        position: { x: -0.4, y: 0, z: 0.2 },
        plantOffsetMeters: { x: -0.4, y: 0, z: 0.2 },
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("refreshes public equipment rows/placements from the case-defined factory, preserving actors", () => {
    const scenarioId = "ed_chest_pain_priority_v2";
    const canonical = createEdChestPainLocalLearnerRuntimeAssetBundle({ scenarioId, scenario: undefined });
    const stale = JSON.parse(JSON.stringify(canonical)) as typeof canonical;
    (stale as unknown as { equipment: unknown }).equipment = [
      { equipmentId: "ecg_cart_equipment", model: { assetId: "ecg", scenarioAssetId: "ecg", blob: { blobName: "ecg.glb", url: "http://127.0.0.1/ecg.glb" } } },
    ];
    (stale.sceneManifest as unknown as { equipmentPlacements: unknown }).equipmentPlacements = {};

    const refreshed = refreshPublicEquipmentInLearnerBundle(stale, scenarioId);
    const placements = refreshed.sceneManifest.equipmentPlacements as Record<string, { position: { x: number; y: number; z: number } }>;
    expect(Object.keys(placements).length).toBeGreaterThan(0);
    expect(refreshed.equipment.map((row) => row.equipmentId)).toEqual(canonical.equipment.map((row) => row.equipmentId));
    const ecg = refreshed.equipment.find((row) => row.equipmentId === "ecg_cart_equipment");
    expect(ecg?.model.assetId).toBe("ecg_cart_12_lead_glb");
    expect(ecg?.model.blob.blobName).toBe("xr-assets/medical-equipment/ecg-cart-12-lead.glb");
    expect(JSON.stringify(refreshed.equipment)).not.toContain("127.0.0.1/ecg.glb");
    expect(refreshed.actors).toEqual(stale.actors);
    expect(refreshed.sceneManifest.actorPlacements).toEqual(stale.sceneManifest.actorPlacements);
    expect(refreshed.notEvidenceFor).toEqual(stale.notEvidenceFor);
    expect(refreshed.sceneManifest.equipmentPlacements).toEqual(canonical.sceneManifest.equipmentPlacements);
  });

  it("preserves actor audit provenance and updates only equipment-scoped refs plus equipment gate ids", () => {
    const scenarioId = "ed_chest_pain_priority_v2";
    const canonical = createEdChestPainLocalLearnerRuntimeAssetBundle({ scenarioId, scenario: undefined });
    const stale = JSON.parse(JSON.stringify(canonical)) as typeof canonical;
    const staleBundle = {
      ...stale,
      equipment: [
        { equipmentId: "ecg_cart_equipment", model: { assetId: "ecg", scenarioAssetId: "ecg", kind: "equipment_model", version: "v1", reviewStatus: "approved_for_local_runtime", blob: { storeKind: "azurite_blob", containerName: "openclinxr-assets", blobName: "ecg.glb" }, provenanceRefs: ["fixture"] } },
      ],
      assemblyAuditMetadata: {
        ...stale.assemblyAuditMetadata,
        sourceDefinitionRefs: ["test_fixture:encounter-publication-payloads"],
        generatedAssetRefs: [],
      },
    } as unknown as Parameters<typeof refreshPublicEquipmentInLearnerBundle>[0];
    (staleBundle as unknown as { actorEquipmentMaterializationGate: unknown }).actorEquipmentMaterializationGate = {
      schemaVersion: "openclinxr.actor-equipment-materialization-gate.v1",
      claimBoundary: "materialization_contract_metadata_only_not_runtime_readiness",
      runtimeSelectionBlockedUntilEvidenceAttached: true,
      actorGate: { actorVariantCount: 3, actorRoles: ["patient", "nurse", "family"] },
      equipmentGate: { equipmentVariantCount: 1, equipmentIds: ["ecg_cart_equipment"], genericEquipmentReuseDetected: true, materializationBlockers: ["generic_equipment_reuse_blocks_equipment_specific_asset_readiness"], caveats: ["Generic equipment reuse is fixture scaffolding until equipment-specific scale and affordance evidence attaches."], recommendedNextAction: "materialize_equipment_specific_variants_before_runtime_readiness_claim" },
      combinedBlockers: ["generic_equipment_reuse_blocks_equipment_specific_asset_readiness"],
      notEvidenceFor: ["runtime_readiness"],
    };
    (staleBundle.sceneManifest as unknown as { equipmentPlacements: unknown }).equipmentPlacements = {};

    const refreshed = refreshPublicEquipmentInLearnerBundle(staleBundle, scenarioId);
    // R1 counterweight: original actor/test-fixture refs remain; no canonical non-equipment actor refs inserted.
    expect(refreshed.assemblyAuditMetadata.sourceDefinitionRefs).toContain("test_fixture:encounter-publication-payloads");
    expect(refreshed.assemblyAuditMetadata.sourceDefinitionRefs).toContain("equipment_source:ecg_cart_equipment:ecg_cart_12_lead_glb");
    expect(refreshed.assemblyAuditMetadata.generatedAssetRefs.every((ref) => ref.kind === "equipment_model")).toBe(true);
    // R2 counterweight: equipment gate ids/count match refreshed rows; actor gate + readiness blocks preserved.
    const gate = (refreshed as unknown as { actorEquipmentMaterializationGate: { actorGate: { actorVariantCount: number }; equipmentGate: { equipmentVariantCount: number; equipmentIds: string[]; materializationBlockers: string[] }; runtimeSelectionBlockedUntilEvidenceAttached: boolean; claimBoundary: string } }).actorEquipmentMaterializationGate;
    expect(gate.equipmentGate.equipmentVariantCount).toBe(refreshed.equipment.length);
    expect(gate.equipmentGate.equipmentIds).toEqual(refreshed.equipment.map((row) => row.equipmentId));
    expect(gate.actorGate.actorVariantCount).toBe(3);
    expect(gate.runtimeSelectionBlockedUntilEvidenceAttached).toBe(true);
    expect(gate.equipmentGate.materializationBlockers.length).toBeGreaterThan(0);
  });

  it("does not mutate input gate and is idempotent on repeated refresh", () => {
    const scenarioId = "ed_chest_pain_priority_v2";
    const canonical = createEdChestPainLocalLearnerRuntimeAssetBundle({ scenarioId, scenario: undefined });
    const stale = JSON.parse(JSON.stringify(canonical)) as typeof canonical;
    const staleBundle = {
      ...stale,
      assemblyAuditMetadata: {
        ...stale.assemblyAuditMetadata,
        sourceDefinitionRefs: ["test_fixture:encounter-publication-payloads"],
        generatedAssetRefs: [],
      },
    } as unknown as Parameters<typeof refreshPublicEquipmentInLearnerBundle>[0];
    (staleBundle as unknown as { actorEquipmentMaterializationGate: unknown }).actorEquipmentMaterializationGate = {
      equipmentGate: { equipmentVariantCount: 1, equipmentIds: ["ecg_cart_equipment"] },
      actorGate: { actorVariantCount: 3 },
      runtimeSelectionBlockedUntilEvidenceAttached: true,
    };
    const before = JSON.stringify(staleBundle);
    const once = refreshPublicEquipmentInLearnerBundle(staleBundle, scenarioId);
    // R3: input bundle unchanged after call.
    expect(JSON.stringify(staleBundle)).toBe(before);
    // R4: second identical refresh is semantically equal to the first.
    const twice = refreshPublicEquipmentInLearnerBundle(once, scenarioId);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    expect(once.assemblyAuditMetadata.sourceDefinitionRefs).toContain("test_fixture:encounter-publication-payloads");
  });

  it("retains original duplicate audit refs as exact prefix and exercises the V2 path", () => {
    const scenarioId = "ed_chest_pain_priority_v2";
    const canonical = createEdChestPainLocalLearnerRuntimeAssetBundle({ scenarioId, scenario: undefined });
    const stale = JSON.parse(JSON.stringify(canonical)) as typeof canonical;
    const dupGenerated = {
      assetId: "fixture_actor_glb",
      scenarioAssetId: "fixture_actor",
      kind: "actor_model",
      version: "v1",
      reviewStatus: "fixture",
      blob: { storeKind: "azurite_blob", containerName: "openclinxr-assets", blobName: "fixture.glb" },
      provenanceRefs: ["fixture"],
    };
    const originalSources = ["test_fixture:encounter-publication-payloads", "test_fixture:encounter-publication-payloads"];
    const staleBundle = {
      ...stale,
      assemblyAuditMetadata: {
        ...stale.assemblyAuditMetadata,
        sourceDefinitionRefs: [...originalSources],
        generatedAssetRefs: [dupGenerated, JSON.parse(JSON.stringify(dupGenerated))],
      },
    } as unknown as Parameters<typeof refreshPublicEquipmentInLearnerBundle>[0];
    const refreshed = refreshPublicEquipmentInLearnerBundle(staleBundle, scenarioId);
    // R5: original prefix (incl. duplicates/order) retained exactly.
    expect(refreshed.assemblyAuditMetadata.sourceDefinitionRefs.slice(0, originalSources.length)).toEqual(originalSources);
    expect(refreshed.assemblyAuditMetadata.generatedAssetRefs.slice(0, 2)).toEqual([dupGenerated, dupGenerated]);
    expect(refreshed.equipment.map((row) => row.equipmentId)).toEqual(canonical.equipment.map((row) => row.equipmentId));
    // R4 still holds: second refresh semantically equal.
    expect(JSON.stringify(refreshPublicEquipmentInLearnerBundle(refreshed, scenarioId))).toBe(JSON.stringify(refreshed));
  });

  it("writer refuses unsupported case before I/O and mismatched manifest before writes", async () => {
    await expect(refreshPublicEquipment("peds_asthma_parent_anxiety_v1", "/nonexistent-public-root")).rejects.toThrow(
      /unsupported authored case/,
    );
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-equipment-writer-guards-"));
    const scenarioId = "ed_chest_pain_priority_v2";
    const canonical = createEdChestPainLocalLearnerRuntimeAssetBundle({ scenarioId, scenario: undefined });
    const stationDir = path.join(tempDir, scenarioId);
    try {
      await mkdir(stationDir, { recursive: true });
      const bundleText = JSON.stringify(canonical);
      const mismatchedManifestText = JSON.stringify({ ...canonical.sceneManifest, scenarioId: "ed_chest_pain_priority_v1" });
      await writeFile(path.join(stationDir, "learner-runtime-bundle.v1.json"), bundleText, "utf8");
      await writeFile(path.join(stationDir, "scene-manifest.v1.json"), mismatchedManifestText, "utf8");
      await expect(refreshPublicEquipment(scenarioId, tempDir)).rejects.toThrow(/standalone manifest scenario mismatch/);
      expect(await readFile(path.join(stationDir, "learner-runtime-bundle.v1.json"), "utf8")).toBe(bundleText);
      expect(await readFile(path.join(stationDir, "scene-manifest.v1.json"), "utf8")).toBe(mismatchedManifestText);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("refuses public equipment refresh on mismatch or unsupported case", () => {
    const scenarioId = "ed_chest_pain_priority_v2";
    const canonical = createEdChestPainLocalLearnerRuntimeAssetBundle({ scenarioId, scenario: undefined });
    expect(() => refreshPublicEquipmentInLearnerBundle(canonical, "peds_asthma_parent_anxiety_v1")).toThrow(/unsupported authored case/);
    const mismatched = { ...canonical, scenarioId: "ed_chest_pain_priority_v1" };
    expect(() => refreshPublicEquipmentInLearnerBundle(mismatched, scenarioId)).toThrow(/bundle scenario mismatch/);
  });

  it("reports not_configured until all generated artifact reports exist", async () => {
    const report = await buildGeneratedEdStationRuntimeBundleReport({
      humanReportPath: "missing-human.json",
      equipmentReportPath: "missing-equipment.json",
      environmentReportPath: "missing-environment.json",
    });

    expect(report.status).toBe("not_configured");
    expect(report.blockers).toEqual([
      "human_report_missing:missing-human.json",
      "equipment_report_missing:missing-equipment.json",
      "environment_report_missing:missing-environment.json",
    ]);
    expect(validateGeneratedEdStationRuntimeBundleReport(report)).toEqual({ ok: true, errors: [] });
  });

  it("assembles a frozen Azurite-backed encounter bundle from generated humanoid, equipment, and environment reports", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-generated-station-bundle-"));
    try {
      const humanPath = path.join(tempDir, "human.json");
      const equipmentPath = path.join(tempDir, "equipment.json");
      const environmentPath = path.join(tempDir, "environment.json");
      await writeFile(humanPath, `${JSON.stringify(humanReport(), null, 2)}\n`, "utf8");
      await writeFile(equipmentPath, `${JSON.stringify(equipmentReport(), null, 2)}\n`, "utf8");
      await writeFile(environmentPath, `${JSON.stringify(environmentReport(), null, 2)}\n`, "utf8");

      const report = await buildGeneratedEdStationRuntimeBundleReport({
        humanReportPath: humanPath,
        equipmentReportPath: equipmentPath,
        environmentReportPath: environmentPath,
      });

      expect(report.status).toBe("bundle_ready");
      expect(report.bundle?.assetStoreKind).toBe("azurite_blob");
      expect(report.bundle?.actors.map((actor) => actor.actorId)).toEqual([
        "patient_robert_hayes_v1",
        "nurse_maria_alvarez_v1",
        "spouse_anna_hayes_v1",
      ]);
      expect(report.bundle?.actors.every((actor) => actor.animationClips.length >= 4)).toBe(true);
      expect(report.bundle?.actors.every((actor) => actor.animationClips.every((clip) => clip.kind === "animation_clip"))).toBe(true);
      expect(report.bundle?.actors.every((actor) => actor.phonemeMap?.kind === "phoneme_map")).toBe(true);
      expect(report.bundle?.sceneManifest.dialogueTurns.every((turn) => turn.affectTimeline?.evidenceCueIds.includes("emotion_aligned_expression_transition_cue"))).toBe(true);
      expect(report.bundle?.sceneManifest.dialogueTurns.find((turn) => turn.traceTag === "urgent_escalation")?.affectTimeline).toMatchObject({
        emotion: "anxious",
        transitionMs: 650,
      });
      expect(report.bundle?.equipment.map((equipment) => equipment.equipmentId)).toEqual([
        "ecg_cart_equipment",
        "iv_stand_equipment",
      ]);
      expect(report.bundle?.equipment[0].model.provenanceRefs).toEqual(expect.arrayContaining([
        "shared-asset-library-lookup://medical_equipment_glb__scenario__ed_chest_pain_station_v1__clinical_zone_layout__recognizable_ed_props__functional_placement__scale_validation__cable_tube_logic",
        ".openclinxr/asset-production/ed-chest-pain/medical-equipment/ed-chest-pain-equipment-realism-manifest.json",
      ]));
      expect(report.bundle?.equipment[1].model.provenanceRefs).toEqual(expect.arrayContaining([
        "shared-asset-library-lookup://medical_equipment_glb__scenario__ed_chest_pain_station_v1__clinical_zone_layout__recognizable_ed_props__functional_placement__scale_validation__cable_tube_logic",
        ".openclinxr/asset-production/ed-chest-pain/medical-equipment/ed-chest-pain-equipment-realism-manifest.json",
      ]));
      expect(report.bundle?.environment.assetId).toBe("openclinxr.ed_chest_pain_priority_v1.environment.generated-glb");
      expect(report.runtimeAssetReviewDecisions).toEqual([]);
      expect(report.learnerBundle).toMatchObject({
        bundleId: "local_exam_run:ed_chest_pain_local_encounter:generated-runtime-assets",
        identityScope: "learner_runtime_opaque_bundle",
      });
      expect(report.learnerBundle).not.toHaveProperty("tenantId");
      expect(report.learnerBundle).not.toHaveProperty("userId");
      expect(report.learnerBundle).not.toHaveProperty("examRunId");
      expect(report.learnerBundle).not.toHaveProperty("encounterId");
      expect(report.notEvidenceFor).toContain("quest_readiness");
      expect(validateGeneratedEdStationRuntimeBundleReport(report)).toEqual({ ok: true, errors: [] });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("writes and validates a report from the CLI", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-generated-station-bundle-cli-"));
    const outputPath = path.join(tempDir, "bundle-report.json");
    const previousExitCode = process.exitCode;
    try {
      await runGeneratedEdStationRuntimeBundleCli(["--output", outputPath]);
      const report = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
      expect(validateGeneratedEdStationRuntimeBundleReport(report)).toEqual({ ok: true, errors: [] });
      await runGeneratedEdStationRuntimeBundleCli(["--validate-latest", "--output", outputPath]);
      expect(process.exitCode).toBe(previousExitCode);
    } finally {
      process.exitCode = previousExitCode;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("carries runtime asset review decisions into the generated bundle report", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-generated-station-bundle-review-"));
    try {
      const humanPath = path.join(tempDir, "human.json");
      const equipmentPath = path.join(tempDir, "equipment.json");
      const environmentPath = path.join(tempDir, "environment.json");
      const reviewPath = path.join(tempDir, "runtime-asset-review-decisions.json");
      await writeFile(humanPath, `${JSON.stringify(humanReport(), null, 2)}\n`, "utf8");
      await writeFile(equipmentPath, `${JSON.stringify(equipmentReport(), null, 2)}\n`, "utf8");
      await writeFile(environmentPath, `${JSON.stringify(environmentReport(), null, 2)}\n`, "utf8");
      await writeFile(reviewPath, `${JSON.stringify([
        {
          assetId: "generated_patient_robert_hayes_humanoid_glb",
          reviewerRole: "asset_pipeline",
          reviewerId: "admin_asset_pipeline_reviewer",
          decision: "approved_for_local_runtime",
          comments: "Local runtime evidence attached.",
          evidenceRefs: ["scene_generation_request:ed_chest_pain_priority_v1:local-admin:asset_pipeline"],
          reviewedAt: "2026-05-23T00:00:00.000Z",
        },
      ], null, 2)}\n`, "utf8");

      const report = await buildGeneratedEdStationRuntimeBundleReport({
        humanReportPath: humanPath,
        equipmentReportPath: equipmentPath,
        environmentReportPath: environmentPath,
        runtimeAssetReviewDecisionsPath: reviewPath,
      });

      expect(report.status).toBe("bundle_ready");
      expect(report.runtimeAssetReviewDecisions).toEqual([
        expect.objectContaining({
          assetId: "generated_patient_robert_hayes_humanoid_glb",
          reviewerRole: "asset_pipeline",
          decision: "approved_for_local_runtime",
        }),
      ]);
      expect(validateGeneratedEdStationRuntimeBundleReport(report)).toEqual({ ok: true, errors: [] });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("assembles scenario-selectable learner bundles for the next encounter loop", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-generated-station-bundle-peds-"));
    try {
      const humanPath = path.join(tempDir, "human.json");
      const equipmentPath = path.join(tempDir, "equipment.json");
      const environmentPath = path.join(tempDir, "environment.json");
      await writeFile(humanPath, `${JSON.stringify(humanReport(), null, 2)}\n`, "utf8");
      await writeFile(equipmentPath, `${JSON.stringify(equipmentReport(), null, 2)}\n`, "utf8");
      await writeFile(environmentPath, `${JSON.stringify(environmentReport(), null, 2)}\n`, "utf8");

      const report = await buildGeneratedEdStationRuntimeBundleReport({
        humanReportPath: humanPath,
        equipmentReportPath: equipmentPath,
        environmentReportPath: environmentPath,
        scenarioId: "peds_asthma_parent_anxiety_v1",
      });

      expect(report.status).toBe("bundle_ready");
      expect(report.bundle).toMatchObject({
        bundleId: "local_exam_run:peds_asthma_parent_anxiety_encounter_v1:generated-runtime-assets",
        scenarioId: "peds_asthma_parent_anxiety_v1",
        encounterId: "peds_asthma_parent_anxiety_encounter_v1",
        stationId: "peds_asthma_parent_anxiety_station_v1",
      });
      expect(report.bundle?.actors.map((actor) => actor.actorId)).toEqual([
        "patient_maya_johnson_v1",
        "parent_tara_johnson_v1",
        "nurse_kevin_lee_v1",
      ]);
      expect(report.actorHumanoidMaterializationContract).toMatchObject({
        schemaVersion: "openclinxr.actor-humanoid-materialization-contract.v1",
        scenarioId: "peds_asthma_parent_anxiety_v1",
        actorSpecificVariantKeysRequired: true,
        sharedNeutralMeshReuseDetected: true,
        sharedNeutralMeshReuseActorIds: [
          "nurse_kevin_lee_v1",
          "parent_tara_johnson_v1",
          "patient_maya_johnson_v1",
        ],
        recommendedNextAction: expect.stringContaining("materialize actor-specific Anny humanoid GLBs"),
      });
      expect(report.actorHumanoidMaterializationContract?.materializationBlockers).toContain("shared_neutral_humanoid_reuse_blocks_actor_specific_asset_readiness");
      expect(report.actorHumanoidMaterializationContract?.caveats.join(" ")).toContain("Shared neutral humanoid reuse is local runtime scaffolding only");
      expect(report.actorHumanoidMaterializationContract?.notEvidenceFor).toEqual([
        "production_asset_readiness",
        "quest_readiness",
        "clinical_validity",
        "scoring_validity",
        "animation_quality",
      ]);
      expect(report.actorHumanoidMaterializationContract?.actorVariants).toEqual(expect.arrayContaining([
        expect.objectContaining({
          actorId: "patient_maya_johnson_v1",
          actorRole: "patient",
          variantSemanticKey: "peds_asthma_parent_anxiety_v1:patient_maya_johnson_v1:patient:anny_humanoid_variant",
          humanoidVariantProfile: expect.objectContaining({
            ageBand: "child",
            bodyScale: "small_child",
            clothingLayer: "patient_gown",
            faceEyeLipRigRequired: true,
            idlePoseRequired: true,
          }),
          requiredMaterializationCueIds: expect.arrayContaining([
            "actor_specific_body_profile_required",
            "actor_specific_clothing_required",
            "actor_specific_hair_face_required",
            "actor_specific_rig_preservation_required",
          ]),
        }),
        expect.objectContaining({
          actorId: "parent_tara_johnson_v1",
          actorRole: "family",
          variantSemanticKey: "peds_asthma_parent_anxiety_v1:parent_tara_johnson_v1:family:anny_humanoid_variant",
          humanoidVariantProfile: expect.objectContaining({
            ageBand: "adult",
            clothingLayer: "civilian_family",
            locomotionRequired: true,
          }),
        }),
        expect.objectContaining({
          actorId: "nurse_kevin_lee_v1",
          actorRole: "nurse",
          variantSemanticKey: "peds_asthma_parent_anxiety_v1:nurse_kevin_lee_v1:nurse:anny_humanoid_variant",
          humanoidVariantProfile: expect.objectContaining({
            clothingLayer: "clinical_scrubs",
            faceEyeLipRigRequired: true,
          }),
        }),
      ]));
      expect(report.equipmentMaterializationContract).toMatchObject({
        schemaVersion: "openclinxr.equipment-materialization-contract.v1",
        scenarioId: "peds_asthma_parent_anxiety_v1",
        equipmentSpecificVariantKeysRequired: true,
        genericEquipmentReuseDetected: true,
        genericEquipmentReuseEquipmentIds: [
          "inhaler_spacer_equipment",
          "nebulizer_mask_equipment",
          "oxygen_wall_port_equipment",
          "parent_chair_equipment",
          "pediatric_stretcher_equipment",
          "pulse_oximeter_equipment",
        ],
        materializationBlockers: ["generic_equipment_reuse_blocks_equipment_specific_asset_readiness"],
        recommendedNextAction: expect.stringContaining("before treating pediatric equipment as Quest, clinical, scoring, or production-ready"),
        notEvidenceFor: [
          "production_asset_readiness",
          "quest_readiness",
          "clinical_validity",
          "scoring_validity",
        ],
      });
      expect(report.equipmentMaterializationContract?.caveats.join(" ")).toContain("Generic equipment reuse is local runtime scaffolding only");
      expect(report.equipmentMaterializationContract?.equipmentVariants).toEqual(expect.arrayContaining([
        equipmentVariantExpectation("pulse_oximeter_equipment"),
        equipmentVariantExpectation("nebulizer_mask_equipment"),
        equipmentVariantExpectation("oxygen_wall_port_equipment"),
        equipmentVariantExpectation("pediatric_stretcher_equipment"),
        equipmentVariantExpectation("parent_chair_equipment"),
        equipmentVariantExpectation("inhaler_spacer_equipment"),
      ]));
      expect(report.bundle?.equipment.map((equipment) => equipment.equipmentId)).toEqual([
        "pulse_oximeter_equipment",
        "nebulizer_mask_equipment",
        "oxygen_wall_port_equipment",
        "pediatric_stretcher_equipment",
        "parent_chair_equipment",
        "inhaler_spacer_equipment",
      ]);
      expect(report.bundle?.sceneManifest.stationContext).toMatchObject({
        title: "Pediatric Asthma",
        subtitle: expect.stringContaining("pulse oximeter"),
        // #127 / #136: learner chart is authored patient voice, not the scoring objective.
        chiefConcern: "My chest feels tight and it is hard to breathe.",
        stageAriaLabel: "Pediatric Urgent Care Bay station scene",
      });
      expect(report.bundle?.sceneManifest.dialogueTurns.map((turn) => turn.traceTag)).toEqual([
        "work_of_breathing_assessment",
        "inhaler_history",
        "trigger_history",
        "oxygen_request",
        "bronchodilator_plan",
        "urgent_escalation",
        "parent_communication",
        "empathy_statement",
        "patient_note_submitted",
      ]);
      expect(report.bundle?.sceneManifest.dialogueTurns.every((turn) =>
        turn.text.includes("scenario definition")
      )).toBe(true);
      expect(report.bundle?.sceneManifest.dialogueTurns).toEqual(expect.arrayContaining([
        expect.objectContaining({
          traceTag: "oxygen_request",
          text: expect.stringContaining("Oxygen saturation is 91% on room air"),
          gazeTargetKind: "actor",
          gazeTargetActorId: "nurse_kevin_lee_v1",
        }),
        expect.objectContaining({
          traceTag: "empathy_statement",
          actorId: "patient_maya_johnson_v1",
          text: expect.stringContaining("fast breathing is scary"),
        }),
        expect.objectContaining({
          traceTag: "trigger_history",
          text: expect.stringContaining("relative with cats"),
        }),
        expect.objectContaining({
          traceTag: "parent_communication",
          actorId: "parent_tara_johnson_v1",
          gazeTargetKind: "actor",
          gazeTargetActorId: "parent_tara_johnson_v1",
          text: expect.stringContaining("Tara can help"),
        }),
      ]));
      expect(report.bundle?.sceneManifest.dialogueTurns.find((turn) => turn.traceTag === "urgent_escalation")).toMatchObject({
        actorId: "nurse_kevin_lee_v1",
        affectTimeline: {
          emotion: "anxious",
          evidenceCueIds: expect.arrayContaining([
            "scenario_actor_baseline_mood_emotion_mapping",
            "case_definition_driven_expression_selection",
          ]),
        },
        caseDefinitionRuntimeSignals: {
          source: "scenario_definition_and_dialogue_seed_bank",
          expressionRequired: true,
          gazeRequired: true,
          lipSyncRequired: true,
          claimBoundary: "case_definition_humanoid_runtime_metadata_only",
          actorRuntimeRealismRequirement: {
            actorId: "nurse_kevin_lee_v1",
            role: "nurse",
            baselineMood: ["focused", "concerned", "ready to act"],
            locomotionRequired: true,
            expressionRequired: true,
            gazeRequired: true,
            lipSyncRequired: true,
            interactionRequired: true,
            requiredCueIds: expect.arrayContaining([
              "scenario_actor_interaction_affordance",
              "scenario_timeline_locomotion_or_posture_change",
            ]),
          },
          requiredSignalIds: expect.arrayContaining([
            "dialogue_viseme_and_gaze_mapping",
            "actor_target_gaze_from_trace_intent",
            "scenario_actor_interaction_affordance",
            "scenario_timeline_locomotion_or_posture_change",
          ]),
        },
      });
      expect(Object.keys(report.bundle?.sceneManifest.equipmentPlacements ?? {})).toEqual([
        "pulse_oximeter_equipment",
        "nebulizer_mask_equipment",
        "oxygen_wall_port_equipment",
        "pediatric_stretcher_equipment",
        "parent_chair_equipment",
        "inhaler_spacer_equipment",
      ]);
      expect(report.learnerBundle).toMatchObject({
        bundleId: "local_exam_run:peds_asthma_parent_anxiety_encounter_v1:generated-runtime-assets",
        identityScope: "learner_runtime_opaque_bundle",
      });
      expect(validateGeneratedEdStationRuntimeBundleReport(report)).toEqual({ ok: true, errors: [] });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("accepts --scenario as a CLI alias for scenario-selectable local smoke commands", async () => {
    const messages: string[] = [];
    const originalStdoutWrite = process.stdout.write;
    try {
      process.stdout.write = ((message: string | Uint8Array) => {
        messages.push(String(message));
        return true;
      }) as typeof process.stdout.write;
      await runGeneratedEdStationRuntimeBundleCli(["--help"]);
    } finally {
      process.stdout.write = originalStdoutWrite;
    }

    expect(messages.join("")).toContain("--scenario <id>");
  });

  it("rejects malformed runtime asset review decisions during report validation", () => {
    const report = {
      schemaVersion: "openclinxr.generated-ed-station-runtime-bundle.v1",
      generatedAt: "2026-05-23T00:00:00.000Z",
      status: "not_configured",
      bundle: null,
      learnerBundle: null,
      bundleBlobName: null,
      runtimeAssetReviewDecisions: [
        {
          assetId: "generated_patient_robert_hayes_humanoid_glb",
          reviewerRole: "asset_pipeline",
          reviewerId: "admin_asset_pipeline_reviewer",
          decision: "approved_for_local_runtime",
          comments: "Missing evidence refs should fail.",
          evidenceRefs: [],
          reviewedAt: "not-a-date",
        },
      ],
      blockers: ["human_report_missing:missing-human.json"],
      productionCloudCall: false,
      notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
    };

    expect(validateGeneratedEdStationRuntimeBundleReport(report)).toEqual({
      ok: false,
      errors: ["/runtimeAssetReviewDecisions/0 invalid"],
    });
  });

  it("rejects generated learner bundles that drop actor-specific humanoid materialization keys", () => {
    const report = {
      schemaVersion: "openclinxr.generated-ed-station-runtime-bundle.v1",
      generatedAt: "2026-05-23T00:00:00.000Z",
      status: "bundle_ready",
      bundle: { assetStoreKind: "azurite_blob" },
      learnerBundle: { identityScope: "learner_runtime_opaque_bundle" },
      actorHumanoidMaterializationContract: {
        schemaVersion: "openclinxr.actor-humanoid-materialization-contract.v1",
        actorSpecificVariantKeysRequired: true,
        actorVariants: [
          {
            actorId: "patient_maya_johnson_v1",
            variantSemanticKey: "shared-neutral-generated-human",
            requiredMaterializationCueIds: [],
          },
        ],
      },
      equipmentMaterializationContract: validEquipmentMaterializationContract(),
      bundleBlobName: null,
      runtimeAssetReviewDecisions: [],
      blockers: [],
      productionCloudCall: false,
      notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
    };

    expect(validateGeneratedEdStationRuntimeBundleReport(report)).toEqual({
      ok: false,
      errors: [
        "/actorHumanoidMaterializationContract/actorVariants/0/variantSemanticKey must be actor-specific Anny variant key",
        "/actorHumanoidMaterializationContract/actorVariants/0/humanoidVariantProfile required",
        "/actorHumanoidMaterializationContract/actorVariants/0/requiredMaterializationCueIds must include actor_specific_body_profile_required",
        "/actorHumanoidMaterializationContract/actorVariants/0/requiredMaterializationCueIds must include actor_specific_clothing_required",
        "/actorHumanoidMaterializationContract/actorVariants/0/requiredMaterializationCueIds must include actor_specific_hair_face_required",
        "/actorHumanoidMaterializationContract/actorVariants/0/requiredMaterializationCueIds must include actor_specific_rig_preservation_required",
      ],
    });
  });

  it("exposes root package scripts", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(rootPackage.scripts["asset:generated-station-bundle"]).toBe("tsx tools/openclinxr/factory/generated-ed-station-runtime-bundle.ts");
    expect(rootPackage.scripts["asset:generated-station-bundle:validate"]).toBe("tsx tools/openclinxr/factory/generated-ed-station-runtime-bundle.ts --validate-latest");
  });
});

function equipmentVariantExpectation(equipmentId: string) {
  return expect.objectContaining({
    equipmentId,
    variantSemanticKey: `peds_asthma_parent_anxiety_v1:${equipmentId}:equipment_materialization_variant`,
    equipmentVariantProfile: expect.objectContaining({
      pediatricUseRequired: true,
      scenarioPlacementRequired: true,
      scaleValidationRequired: true,
    }),
    requiredMaterializationCueIds: expect.arrayContaining([
      "equipment_specific_mesh_required",
      "equipment_specific_scale_required",
      "equipment_specific_placement_required",
      "equipment_specific_affordance_required",
    ]),
    requiredEvidenceRefs: expect.arrayContaining([
      "scenario_specific_equipment_variant_evidence",
      "equipment_scale_validation_evidence",
      "equipment_placement_anchor_evidence",
      "clinical_affordance_evidence",
    ]),
  });
}

function validEquipmentMaterializationContract() {
  return {
    schemaVersion: "openclinxr.equipment-materialization-contract.v1",
    scenarioId: "peds_asthma_parent_anxiety_v1",
    source: "generated_station_runtime_bundle",
    equipmentSpecificVariantKeysRequired: true,
    genericEquipmentReuseDetected: true,
    genericEquipmentReuseEquipmentIds: ["pulse_oximeter_equipment", "nebulizer_mask_equipment"],
    equipmentVariants: [
      {
        equipmentId: "pulse_oximeter_equipment",
        modelAssetId: "openclinxr.peds_asthma_parent_anxiety_v1.pulse_oximeter_equipment.generated-glb",
        variantSemanticKey: "peds_asthma_parent_anxiety_v1:pulse_oximeter_equipment:equipment_materialization_variant",
        sourceBlobName: "xr-assets/generated/equipment/ecg-cart-12-lead.glb",
        equipmentVariantProfile: {
          equipmentFamily: "pulse_oximeter",
          pediatricUseRequired: true,
          scenarioPlacementRequired: true,
          scaleValidationRequired: true,
          interactionAffordanceRequired: true,
        },
        requiredMaterializationCueIds: [
          "equipment_specific_mesh_required",
          "equipment_specific_scale_required",
          "equipment_specific_placement_required",
          "equipment_specific_affordance_required",
        ],
        requiredEvidenceRefs: [
          "scenario_specific_equipment_variant_evidence",
          "equipment_scale_validation_evidence",
          "equipment_placement_anchor_evidence",
          "clinical_affordance_evidence",
        ],
      },
    ],
    materializationBlockers: ["generic_equipment_reuse_blocks_equipment_specific_asset_readiness"],
    caveats: ["Generic equipment reuse is local runtime scaffolding only until equipment-specific evidence attaches."],
    recommendedNextAction: "materialize equipment-specific generated GLBs or prefabs before treating pediatric equipment as Quest, clinical, scoring, or production-ready",
    notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
  };
}

function humanReport() {
  return {
    schemaVersion: "openclinxr.generated-human-rigging-artifacts.v1",
    kind: "generated_human_rigging_artifacts",
    generatedAt: "2026-05-22T00:00:00.000Z",
    tool: { name: "tools/openclinxr/generated-human-rigging-artifacts.ts", blenderVersion: "Blender 5.1.1", elapsedMs: 1 },
    policy: { localOnly: true, installsIntroduced: true, cloudApisUsed: false, paidApisUsed: false, externalAssetsUsed: false, generatedThirdPartyAssetsCommitted: false, productionAssetReadinessClaimed: false },
    input: { laneId: "generatedHumanRigging", stationSlug: "ed-chest-pain", actorSlug: "neutral-generated-human", generationMode: "anny_parametric_body_mesh_with_blender_canonical_rig", sourceLicensePosture: "anny_apache_2_code_mpfb2_assets_license_recorded", preferredGeneratorToolId: "anny" },
    artifacts: {
      glbPath: ".openclinxr/asset-production/ed-chest-pain/generated-human-rigging/neutral-generated-human.glb",
      annySourceObjPath: ".openclinxr/asset-production/ed-chest-pain/generated-human-rigging/anny-neutral-generated-human.obj",
      annySourceManifestPath: ".openclinxr/asset-production/ed-chest-pain/generated-human-rigging/anny-source-generator-manifest.json",
      canonicalSkeletonBindingPath: ".openclinxr/asset-production/ed-chest-pain/generated-human-rigging/canonical-skeleton-binding.json",
      skinWeightQualityPath: ".openclinxr/asset-production/ed-chest-pain/generated-human-rigging/skin-weight-quality.json",
      humanoidRealismManifestPath: ".openclinxr/asset-production/ed-chest-pain/generated-human-rigging/neutral-generated-human-realism-manifest.json",
    },
    output: { glbBytes: 128, magic: "glTF", version: 2, declaredLength: 128, semanticInventory: { nodeCount: 1, meshCount: 1, skinCount: 1, materialCount: 1, animationCount: 0, nodeNames: [], skinJointNames: [], requiredBoneNames: [], missingRequiredBoneNames: [], requiredAnchorNodeNames: [], missingRequiredAnchorNodeNames: [], requiredEmbodimentNodeNames: [], missingRequiredEmbodimentNodeNames: [] }, embodimentRigging: { sourceGeneratorRequired: "anny", faceRigPresent: true, lipSyncControlsPresent: true, eyeGazeControlsPresent: true, ragdollCollisionProxyPresent: true, physicianInteractionTargetPresent: true, runtimeDialogueLipSyncRequired: true, runtimeDialogueGazeRequired: true } },
    verdict: { passed: true, readyForProductionAssets: false, blockers: [] },
  };
}

function equipmentReport() {
  return {
    schemaVersion: "openclinxr.medical-equipment-artifacts.v1",
    kind: "medical_equipment_artifacts",
    generatedAt: "2026-05-22T00:00:00.000Z",
    tool: { name: "tools/openclinxr/medical-equipment-artifacts.ts", blenderVersion: "Blender 5.1.1", elapsedMs: 1 },
    policy: { localOnly: true, installsIntroduced: false, cloudApisUsed: false, paidApisUsed: false, externalAssetsUsed: false, generatedThirdPartyAssetsCommitted: false, productionAssetReadinessClaimed: false },
    input: { laneId: "medicalEquipmentLibrary", stationSlug: "ed-chest-pain", generationMode: "local_blender_scripted_equipment_fixture" },
    artifacts: {
      ecgCartGlbPath: ".openclinxr/asset-production/ed-chest-pain/medical-equipment/ecg-cart-12-lead.glb",
      ivPoleWithPumpGlbPath: ".openclinxr/asset-production/ed-chest-pain/medical-equipment/iv-pole-with-pump.glb",
      equipmentProvenancePath: ".openclinxr/asset-production/ed-chest-pain/medical-equipment/equipment-provenance.json",
      equipmentRealismManifestPath: ".openclinxr/asset-production/ed-chest-pain/medical-equipment/ed-chest-pain-equipment-realism-manifest.json",
    },
    output: { ecgCartGlbBytes: 64, ivPoleWithPumpGlbBytes: 72, requiredObjectNames: [], caveats: [] },
    verdict: { passed: true, readyForProductionAssets: false, blockers: [] },
  };
}

function environmentReport() {
  return {
    schemaVersion: "openclinxr.environment-artifacts.v1",
    kind: "environment_artifacts",
    generatedAt: "2026-05-22T00:00:00.000Z",
    tool: { name: "tools/openclinxr/environment-artifacts.ts" },
    policy: { localOnly: true, installsIntroduced: false, cloudApisUsed: false, paidApisUsed: false, externalAssetsUsed: false, generatedThirdPartyAssetsCommitted: false, productionAssetReadinessClaimed: false, questReadinessClaimed: false },
    input: { laneId: "environmentShell", stationSlug: "ed-chest-pain", workOrderId: "environment_work_order:ed_chest_pain_priority_v1:ed_exam_bay_environment", generationMode: "repo_authored_environment_layout_evidence_bundle" },
    artifacts: { edExamBayShellGlbPath: ".openclinxr/asset-production/ed-chest-pain/environment/ed-exam-bay-shell.glb", layoutManifestPath: ".openclinxr/asset-production/ed-chest-pain/environment/ed-exam-bay-layout.json", equipmentPlacementManifestPath: ".openclinxr/asset-production/ed-chest-pain/environment/equipment-placement-manifest.json", questBudgetPath: ".openclinxr/asset-production/ed-chest-pain/environment/quest-environment-budget.json" },
    output: { edExamBayShellGlbBytes: 96, spatialZoneCount: 3, equipmentPlacementCount: 2, interactionAnchorCount: 4, environmentRealismCueCount: 6, caveats: [] },
    verdict: { passed: true, readyForProductionEnvironment: false, blockers: [] },
  };
}

describe("clinic fixture public refresh correction", () => {
  const CLINIC_SCENARIO_ID = "clinic_abdominal_pain_interpreter_v1";
  const EXPECTED_FIXTURE_SLOTS = { patient_chair: { x: 0.25, y: 0, z: -0.85 } };

  async function writeReportInputs(tempDir: string) {
    const humanPath = path.join(tempDir, "human.json");
    const equipmentPath = path.join(tempDir, "equipment.json");
    const environmentPath = path.join(tempDir, "environment.json");
    await writeFile(humanPath, `${JSON.stringify(humanReport(), null, 2)}\n`, "utf8");
    await writeFile(equipmentPath, `${JSON.stringify(equipmentReport(), null, 2)}\n`, "utf8");
    await writeFile(environmentPath, `${JSON.stringify(environmentReport(), null, 2)}\n`, "utf8");
    return { humanReportPath: humanPath, equipmentReportPath: equipmentPath, environmentReportPath: environmentPath };
  }

  it("general builder propagates the owner fixture map with finite coordinates, and a non-owner case gains no map", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-fixture-owner-"));
    try {
      const inputs = await writeReportInputs(tempDir);
      const owner = await buildGeneratedEdStationRuntimeBundleReport({ ...inputs, scenarioId: CLINIC_SCENARIO_ID });
      expect(owner.status).toBe("bundle_ready");
      const slots = owner.bundle?.sceneManifest.fixtureSlotPlacements;
      expect(slots).toBeDefined();
      if (slots === undefined) throw new Error("owner fixture map missing");
      expect(slots).toEqual(EXPECTED_FIXTURE_SLOTS);
      for (const position of Object.values(slots)) {
        expect(Number.isFinite(position.x)).toBe(true);
        expect(Number.isFinite(position.y)).toBe(true);
        expect(Number.isFinite(position.z)).toBe(true);
      }
      const other = await buildGeneratedEdStationRuntimeBundleReport({ ...inputs, scenarioId: "peds_asthma_parent_anxiety_v1" });
      expect(other.status).toBe("bundle_ready");
      expect("fixtureSlotPlacements" in (other.bundle?.sceneManifest ?? {})).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fixture refresh writes both files, keeps every other field, and is idempotent", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-fixture-refresh-"));
    const stationDir = path.join(tempDir, CLINIC_SCENARIO_ID);
    try {
      await mkdir(stationDir, { recursive: true });
      const bundle = {
        scenarioId: CLINIC_SCENARIO_ID,
        actors: [{ actorId: "patient_lucia_morales_v1" }],
        equipment: [{ equipmentId: "exam_table_equipment" }],
        sceneManifest: {
          scenarioId: CLINIC_SCENARIO_ID,
          actorPlacements: { patient_lucia_morales_v1: {} },
          equipmentPlacements: { exam_table_equipment: {} },
        },
      };
      const manifest = {
        scenarioId: CLINIC_SCENARIO_ID,
        actorPlacements: { patient_lucia_morales_v1: {} },
        equipmentPlacements: { exam_table_equipment: {} },
      };
      await writeFile(path.join(stationDir, "learner-runtime-bundle.v1.json"), JSON.stringify(bundle), "utf8");
      await writeFile(path.join(stationDir, "scene-manifest.v1.json"), JSON.stringify(manifest), "utf8");

      await runGeneratedEdStationRuntimeBundleCli(["--refresh-public-fixtures", "--scenario-id", CLINIC_SCENARIO_ID, "--public-root", tempDir]);

      const refreshedBundle = JSON.parse(await readFile(path.join(stationDir, "learner-runtime-bundle.v1.json"), "utf8")) as typeof bundle & { sceneManifest: { fixtureSlotPlacements: unknown } };
      const refreshedManifest = JSON.parse(await readFile(path.join(stationDir, "scene-manifest.v1.json"), "utf8")) as typeof manifest & { fixtureSlotPlacements: unknown };
      expect(refreshedBundle.sceneManifest.fixtureSlotPlacements).toEqual(EXPECTED_FIXTURE_SLOTS);
      expect(refreshedManifest.fixtureSlotPlacements).toEqual(EXPECTED_FIXTURE_SLOTS);
      const { fixtureSlotPlacements: _bundleSlots, ...restBundle } = refreshedBundle.sceneManifest;
      expect(restBundle).toEqual(bundle.sceneManifest);
      const { fixtureSlotPlacements: _manifestSlots, ...restManifest } = refreshedManifest;
      expect(restManifest).toEqual(manifest);
      expect(refreshedBundle.actors).toEqual(bundle.actors);
      expect(refreshedBundle.equipment).toEqual(bundle.equipment);

      const onceBundle = await readFile(path.join(stationDir, "learner-runtime-bundle.v1.json"), "utf8");
      const onceManifest = await readFile(path.join(stationDir, "scene-manifest.v1.json"), "utf8");
      await runGeneratedEdStationRuntimeBundleCli(["--refresh-public-fixtures", "--scenario-id", CLINIC_SCENARIO_ID, "--public-root", tempDir]);
      expect(await readFile(path.join(stationDir, "learner-runtime-bundle.v1.json"), "utf8")).toBe(onceBundle);
      expect(await readFile(path.join(stationDir, "scene-manifest.v1.json"), "utf8")).toBe(onceManifest);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("refuses unsupported, mismatched, and scenario-less manifests without writing either file", async () => {
    await expect(
      runGeneratedEdStationRuntimeBundleCli(["--refresh-public-fixtures", "--scenario-id", "peds_asthma_parent_anxiety_v1", "--public-root", "/nonexistent-public-root"]),
    ).rejects.toThrow(/unsupported authored case/);
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-fixture-guards-"));
    const stationDir = path.join(tempDir, CLINIC_SCENARIO_ID);
    try {
      await mkdir(stationDir, { recursive: true });
      const cases: Array<[string, string]> = [
        [JSON.stringify({ scenarioId: "ed_chest_pain_priority_v1", sceneManifest: { scenarioId: "ed_chest_pain_priority_v1" } }), JSON.stringify({ scenarioId: "ed_chest_pain_priority_v1" })],
        [JSON.stringify({ scenarioId: CLINIC_SCENARIO_ID, sceneManifest: { scenarioId: CLINIC_SCENARIO_ID } }), JSON.stringify({ actorPlacements: {} })],
      ];
      for (const [bundleText, manifestText] of cases) {
        await writeFile(path.join(stationDir, "learner-runtime-bundle.v1.json"), bundleText, "utf8");
        await writeFile(path.join(stationDir, "scene-manifest.v1.json"), manifestText, "utf8");
        await expect(
          runGeneratedEdStationRuntimeBundleCli(["--refresh-public-fixtures", "--scenario-id", CLINIC_SCENARIO_ID, "--public-root", tempDir]),
        ).rejects.toThrow(/scenario mismatch/);
        expect(await readFile(path.join(stationDir, "learner-runtime-bundle.v1.json"), "utf8")).toBe(bundleText);
        expect(await readFile(path.join(stationDir, "scene-manifest.v1.json"), "utf8")).toBe(manifestText);
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("parser rejects unknown flags and conflicting modes before any I/O", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-fixture-parser-"));
    try {
      await expect(runGeneratedEdStationRuntimeBundleCli(["--bogus-flag-xyz", "--output", path.join(tempDir, "r.json")])).rejects.toThrow(/Unknown flag/);
      expect((await import("node:fs")).existsSync(path.join(tempDir, "r.json"))).toBe(false);
      await expect(runGeneratedEdStationRuntimeBundleCli(["-x", "--output", path.join(tempDir, "r2.json")])).rejects.toThrow(/Unknown flag/);
      expect((await import("node:fs")).existsSync(path.join(tempDir, "r2.json"))).toBe(false);
      await expect(runGeneratedEdStationRuntimeBundleCli(["--refresh-public-place", "--output", path.join(tempDir, "r3.json")])).rejects.toThrow(/Unknown/);
      expect((await import("node:fs")).existsSync(path.join(tempDir, "r3.json"))).toBe(false);
      await expect(
        runGeneratedEdStationRuntimeBundleCli(["--refresh-public-placements", "--refresh-public-fixtures", "--scenario-id", CLINIC_SCENARIO_ID, "--public-root", tempDir]),
      ).rejects.toThrow(/mutually exclusive/);
      await expect(
        runGeneratedEdStationRuntimeBundleCli(["--refresh-public-fixtures", "--write-azurite", "--scenario-id", CLINIC_SCENARIO_ID, "--public-root", tempDir]),
      ).rejects.toThrow(/cannot combine/);
      await expect(
        runGeneratedEdStationRuntimeBundleCli(["--refresh-public-fixtures", "--validate-latest", "--scenario-id", CLINIC_SCENARIO_ID, "--public-root", tempDir, "--output", path.join(tempDir, "r.json")]),
      ).rejects.toThrow(/cannot combine/);
      expect((await import("node:fs")).existsSync(path.join(tempDir, "r.json"))).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

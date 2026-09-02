import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildEncounterMaterializationEvidenceReport,
  COMPILE_NODE_FAMILIES,
  emitCompileNodes,
  planWardrobeBake,
  splitCharacterBakers,
  validateEncounterMaterializationEvidenceReport,
  type CompileGraphNode,
} from "./encounter-materialization-evidence.js";
import type { GeneratedEdStationRuntimeBundleReport } from "./generated-ed-station-runtime-bundle.js";

const notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"] = [
  "production_asset_readiness",
  "quest_readiness",
  "clinical_validity",
  "scoring_validity",
];

describe("encounter materialization evidence", () => {
  it("keeps actor/equipment evidence non-attachable while shared-neutral and generic evidence is missing", () => {
    const report = buildEncounterMaterializationEvidenceReport({
      generatedAt: "2026-05-28T00:00:00.000Z",
      bundleReport: bundleReportFixture(),
    });

    expect(report).toMatchObject({
      schemaVersion: "openclinxr.encounter-materialization-evidence.v1",
      status: "blocked_missing_actor_or_equipment_specific_evidence",
      attachableToRuntimeSelection: false,
      scenarioId: "peds_asthma_parent_anxiety_v1",
      blockers: expect.arrayContaining([
        "shared_neutral_humanoid_reuse_blocks_actor_specific_asset_readiness",
        "generic_equipment_reuse_blocks_equipment_specific_asset_readiness",
        "actor_materialization_evidence_missing:patient_maya_johnson_v1:actor_specific_body_profile_required",
        "equipment_materialization_evidence_missing:nebulizer_mask_equipment:scenario_specific_equipment_variant_evidence",
      ]),
      actorEvidence: [
        expect.objectContaining({
          actorId: "patient_maya_johnson_v1",
          variantSemanticKey: "peds_asthma_parent_anxiety_v1:patient_maya_johnson_v1:patient:anny_humanoid_variant",
          requiredEvidenceRefs: expect.arrayContaining([
            "actor-materialization-evidence://peds_asthma_parent_anxiety_v1:patient_maya_johnson_v1:patient:anny_humanoid_variant/actor_specific_body_profile_required",
          ]),
        }),
      ],
      equipmentEvidence: [
        expect.objectContaining({
          equipmentId: "nebulizer_mask_equipment",
          requiredEvidenceRefs: expect.arrayContaining([
            "equipment-materialization-evidence://peds_asthma_parent_anxiety_v1:nebulizer_mask_equipment:equipment_materialization_variant/scenario_specific_equipment_variant_evidence",
          ]),
        }),
      ],
      claimBoundary: "materialization_evidence_attachment_contract_not_runtime_readiness",
      notEvidenceFor: ["runtime_readiness", "quest_readiness", "production_asset_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
    });
    expect(validateEncounterMaterializationEvidenceReport(report)).toEqual({ ok: true, errors: [] });
  });

  /**
   * WCG Phase 0 — emit unsplit actor/equipment nodes only.
   * Diagnosis (immutable): evidence.v1 has no compile node list; a graph over requestedStages
   * is one node per actor. Do not invent room/garment/physics families here.
   */
  it("Phase 0: two actors + one equipment emit three unsplit nodes and no room family", () => {
    const report = buildEncounterMaterializationEvidenceReport({
      generatedAt: "2026-05-28T00:00:00.000Z",
      bundleReport: twoActorBundleFixture(),
    });
    const nodes = emitCompileNodes(report);
    const evidenceNodes = nodes.filter((n) => n.family === "ActorVariant" || n.family === "EquipVariant");
    expect(report.actorEvidence).toHaveLength(2);
    expect(report.equipmentEvidence).toHaveLength(1);
    expect(evidenceNodes).toHaveLength(3);
    expect(evidenceNodes.map((n) => n.family).sort()).toEqual(["ActorVariant", "ActorVariant", "EquipVariant"]);
    expect(nodes.every((n) => (COMPILE_NODE_FAMILIES as readonly string[]).includes(n.family))).toBe(true);
    // INVERTED GUARD (was: no room family, tsk_a1b8d328db95d038). This asserted Phase 0's
    // actor+equipment-only emission. W3 makes Room emittable from the case, so the guard is
    // flipped rather than deleted: the fixture's peds_asthma_parent_anxiety_v1 resolves, so a
    // Room node MUST now appear. The evidence-derived count above is unchanged at 3.
    expect(nodes.some((n) => n.family === "Room")).toBe(true);
    expect(nodes.filter((n) => n.family === "ActorVariant").every((n) => n.bakerId === "unsplit_character")).toBe(true);
    expect(nodes.filter((n) => n.family === "EquipVariant").every((n) => n.bakerId === "unsplit_equipment")).toBe(true);
    expect(nodes.every((n) => n.status === "planned_unsplit" && n.cacheKey === null && n.parents.length === 0)).toBe(true);
  });

  it("Phase 0: dated 2026-05-28 evidence JSON still validates (no required compile fields)", () => {
    const raw = JSON.parse(
      readFileSync(
        "docs/openclinxr/encounter-materialization-evidence-peds-asthma-parent-anxiety-2026-05-28.json",
        "utf8",
      ),
    ) as unknown;
    expect(validateEncounterMaterializationEvidenceReport(raw)).toEqual({ ok: true, errors: [] });
    const dated = raw as Parameters<typeof emitCompileNodes>[0];
    const nodes = emitCompileNodes(dated);
    // Scoped to the evidence-derived families (tsk_a1b8d328db95d038). This asserted that
    // emission is one node per evidence row and nothing else; W3 adds case-derived Room and
    // DialoguePolicy nodes alongside. The one-node-per-row invariant is what this test is
    // about and it is unchanged.
    const evidenceNodes = nodes.filter((n) => n.family === "ActorVariant" || n.family === "EquipVariant");
    expect(evidenceNodes.length).toBe(dated.actorEvidence.length + dated.equipmentEvidence.length);
    expect(evidenceNodes.every((n) => n.family === "ActorVariant" || n.family === "EquipVariant")).toBe(true);
  });

  it("Phase 0: copies prior lock and contentHash by nodeId; does not invent a third family", () => {
    const report = buildEncounterMaterializationEvidenceReport({
      generatedAt: "2026-05-28T00:00:00.000Z",
      bundleReport: twoActorBundleFixture(),
    });
    const prior: CompileGraphNode[] = [
      {
        nodeId: "actor:patient_maya_johnson_v1",
        family: "ActorVariant",
        bakerId: "unsplit_character",
        spec: {
          scenarioId: "peds_asthma_parent_anxiety_v1",
          actorId: "patient_maya_johnson_v1",
          variantSemanticKey: "x",
          sourceBlobName: "y",
        },
        parents: [],
        cacheKey: null,
        contentHash: "sha256:prior",
        lock: { locked: true, lockKind: "faculty_keep_artifact" },
        status: "planned_unsplit",
      },
    ];
    const nodes = emitCompileNodes(report, prior);
    const maya = nodes.find((n) => n.nodeId === "actor:patient_maya_johnson_v1");
    expect(maya?.lock).toEqual({ locked: true, lockKind: "faculty_keep_artifact" });
    expect(maya?.contentHash).toBe("sha256:prior");
    const tara = nodes.find((n) => n.nodeId === "actor:parent_tara_johnson_v1");
    expect(tara?.lock).toEqual({ locked: false });
    expect(tara?.contentHash).toBeNull();
  });

  it("Phase 1: dated JSON still validates; lock.locked string is refused; phenotype path ok", () => {
    const raw = JSON.parse(
      readFileSync(
        "docs/openclinxr/encounter-materialization-evidence-peds-asthma-parent-anxiety-2026-05-28.json",
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(validateEncounterMaterializationEvidenceReport(raw)).toEqual({ ok: true, errors: [] });
    const withBadLock = {
      ...raw,
      compileVersion: 1,
      compileNodes: [
        {
          nodeId: "actor:patient_maya_johnson_v1",
          lock: { locked: "yes" },
        },
      ],
    };
    const bad = validateEncounterMaterializationEvidenceReport(withBadLock);
    expect(bad.ok).toBe(false);
    expect(bad.errors.some((e) => e.includes("locked must be boolean"))).toBe(true);
    const withBadPath = {
      ...raw,
      actorEvidence: [
        {
          ...(raw.actorEvidence as object[])[0],
          overridePatch: { op: "replace", path: "/makeHerNicer", value: "yes" },
        },
      ],
    };
    const pathBad = validateEncounterMaterializationEvidenceReport(withBadPath);
    expect(pathBad.ok).toBe(false);
    // Message text updated (W12, tsk_de6cae5304badfa6). This matched "ActorPhenotypeSchema",
    // which stopped being true when the allowlist gained the four Lighting pointers — keeping
    // the old noun would have made the error lie about a valid /wallColor patch. The SUBJECT of
    // this assertion is unchanged and untouched: a bogus path is still refused (pathBad.ok is
    // false above, and that line did not need editing). Asserting on the offending path rather
    // than on a noun in the sentence, so the next rename does not break it.
    expect(pathBad.errors.some((e) => e.includes("overridePatch/path"))).toBe(true);
    const withGood = {
      ...raw,
      caseDefVersion: 1,
      compileVersion: 3,
      actorEvidence: [
        {
          ...(raw.actorEvidence as object[])[0],
          lock: { locked: true },
          overridePatch: { op: "replace", path: "/garmentLayers", value: ["makeclothes_library_scrub_shirt"] },
        },
        ...(raw.actorEvidence as object[]).slice(1),
      ],
    };
    expect(validateEncounterMaterializationEvidenceReport(withGood)).toEqual({ ok: true, errors: [] });
  });

  /**
   * WCG-4 (Phase 4) — baker split so a lock can skip a baker.
   * emitCompileNodes stays unsplit (Phase 0); splitCharacterBakers gives the two
   * stages distinct bakerIds so unsplit_character is NOT the only node after the
   * split, and a wardrobe lock skips the wardrobe baker while the body rebakes.
   */
  it("WCG-4: splitCharacterBakers emits distinct body_character + wardrobe_character bakerIds", () => {
    const report = buildEncounterMaterializationEvidenceReport({
      generatedAt: "2026-05-28T00:00:00.000Z",
      bundleReport: twoActorBundleFixture(),
    });
    const nodes = emitCompileNodes(report);
    // Phase 0 still emits unsplit nodes only — for the CHARACTER/EQUIPMENT families this test
    // is about (scoped tsk_a1b8d328db95d038; W3 adds Room and DialoguePolicy nodes carrying
    // their own baker ids, which are not part of the split claim under test here).
    const bakeable = nodes.filter((n) => n.family === "ActorVariant" || n.family === "EquipVariant");
    expect(bakeable.every((n) => n.bakerId === "unsplit_character" || n.bakerId === "unsplit_equipment")).toBe(true);
    const unsplit = nodes.find((n) => n.nodeId === "actor:patient_maya_johnson_v1")!;
    const [body, wardrobe] = splitCharacterBakers(unsplit);
    expect(body.bakerId).toBe("body_character");
    expect(wardrobe.bakerId).toBe("wardrobe_character");
    expect(body.bakerId).not.toBe(wardrobe.bakerId);
    // After the split, unsplit_character is NOT the only baker id — the point of WCG-4.
    const splitIds = [body.bakerId, wardrobe.bakerId];
    expect(splitIds).not.toContain("unsplit_character");
    expect(new Set(splitIds).size).toBe(2);
    expect(body.nodeId).toBe("actor:patient_maya_johnson_v1:body");
    expect(wardrobe.nodeId).toBe("actor:patient_maya_johnson_v1:wardrobe");
    expect(body.parents).toEqual([]);
    expect(wardrobe.parents).toEqual([body.nodeId]); // body_to_clothing edge
    expect(wardrobe.lock).toEqual(unsplit.lock); // copy-prior rule, not a silent wipe
  });

  it("WCG-4: split refuses an equipment or already-split node (no vacuous one-node DAG)", () => {
    const report = buildEncounterMaterializationEvidenceReport({
      generatedAt: "2026-05-28T00:00:00.000Z",
      bundleReport: twoActorBundleFixture(),
    });
    const nodes = emitCompileNodes(report);
    const equip = nodes.find((n) => n.family === "EquipVariant")!;
    expect(() => splitCharacterBakers(equip)).toThrow(/unsplit ActorVariant/);
    const [body] = splitCharacterBakers(nodes.find((n) => n.nodeId === "actor:patient_maya_johnson_v1")!);
    expect(() => splitCharacterBakers(body)).toThrow(/unsplit ActorVariant/);
  });

  it("WCG-4 control/treatment: lock wardrobe, body topology hash unchanged -> wardrobe baker skipped", () => {
    const report = buildEncounterMaterializationEvidenceReport({
      generatedAt: "2026-05-28T00:00:00.000Z",
      bundleReport: twoActorBundleFixture(),
    });
    const unsplit = emitCompileNodes(report).find((n) => n.nodeId === "actor:patient_maya_johnson_v1")!;
    const [, wardrobe] = splitCharacterBakers(unsplit);
    const locked = {
      ...wardrobe,
      contentHash: "sha256:wardrobe-baked",
      lock: { locked: true, lockKind: "faculty_keep_artifact" },
    };
    const decision = planWardrobeBake(locked, "sha256:body-A", "sha256:body-A");
    expect(decision.bake).toBe(false);
    expect(decision.reason).toBe("locked_skip");
    expect(decision.stale).toBe(false);
  });

  it("WCG-4 control/treatment: lock wardrobe, body macros change -> wardrobe skipped but stale (lock honored)", () => {
    const report = buildEncounterMaterializationEvidenceReport({
      generatedAt: "2026-05-28T00:00:00.000Z",
      bundleReport: twoActorBundleFixture(),
    });
    const unsplit = emitCompileNodes(report).find((n) => n.nodeId === "actor:patient_maya_johnson_v1")!;
    const [, wardrobe] = splitCharacterBakers(unsplit);
    const locked = {
      ...wardrobe,
      contentHash: "sha256:wardrobe-baked",
      lock: { locked: true, lockKind: "faculty_keep_artifact" },
    };
    const decision = planWardrobeBake(locked, "sha256:body-A", "sha256:body-B");
    expect(decision.bake).toBe(false); // NEVER rebake a locked node
    expect(decision.reason).toBe("locked_stale");
    expect(decision.stale).toBe(true); // faculty must relock
  });

  it("WCG-4 control/treatment: unlock wardrobe, body macros change -> wardrobe rebakes", () => {
    const report = buildEncounterMaterializationEvidenceReport({
      generatedAt: "2026-05-28T00:00:00.000Z",
      bundleReport: twoActorBundleFixture(),
    });
    const unsplit = emitCompileNodes(report).find((n) => n.nodeId === "actor:patient_maya_johnson_v1")!;
    const [, wardrobe] = splitCharacterBakers(unsplit);
    const baked = { ...wardrobe, contentHash: "sha256:wardrobe-baked" };
    const decision = planWardrobeBake(baked, "sha256:body-A", "sha256:body-B");
    expect(decision.bake).toBe(true);
    expect(decision.reason).toBe("body_changed");
    expect(decision.stale).toBe(false);
  });

  it("WCG-4 control/treatment: unlocked wardrobe, body unchanged -> cache hit (no rebake)", () => {
    const report = buildEncounterMaterializationEvidenceReport({
      generatedAt: "2026-05-28T00:00:00.000Z",
      bundleReport: twoActorBundleFixture(),
    });
    const unsplit = emitCompileNodes(report).find((n) => n.nodeId === "actor:patient_maya_johnson_v1")!;
    const [, wardrobe] = splitCharacterBakers(unsplit);
    const baked = { ...wardrobe, contentHash: "sha256:wardrobe-baked" };
    const decision = planWardrobeBake(baked, "sha256:body-A", "sha256:body-A");
    expect(decision.bake).toBe(false);
    expect(decision.reason).toBe("cache_hit");
  });

  it("unlocked + baked + same body + recipe cacheKey change -> recipe_changed", () => {
    const report = buildEncounterMaterializationEvidenceReport({
      generatedAt: "2026-05-28T00:00:00.000Z",
      bundleReport: twoActorBundleFixture(),
    });
    const unsplit = emitCompileNodes(report).find((n) => n.nodeId === "actor:patient_maya_johnson_v1")!;
    const [, wardrobe] = splitCharacterBakers(unsplit);
    const baked = { ...wardrobe, contentHash: "sha256:wardrobe-baked" };
    const decision = planWardrobeBake(baked, "sha256:body-A", "sha256:body-A", false, {
      plannedCacheKey: "key-after-garment-override",
      priorCacheKey: "key-before-garment-override",
    });
    expect(decision.bake).toBe(true);
    expect(decision.reason).toBe("recipe_changed");
    expect(decision.stale).toBe(false);
  });

  it("locked + baked + same body + recipe cacheKey change -> locked_stale, never bake", () => {
    const report = buildEncounterMaterializationEvidenceReport({
      generatedAt: "2026-05-28T00:00:00.000Z",
      bundleReport: twoActorBundleFixture(),
    });
    const unsplit = emitCompileNodes(report).find((n) => n.nodeId === "actor:patient_maya_johnson_v1")!;
    const [, wardrobe] = splitCharacterBakers(unsplit);
    const locked = {
      ...wardrobe,
      contentHash: "sha256:wardrobe-baked",
      lock: { locked: true, lockKind: "faculty_keep_artifact" as const },
    };
    const decision = planWardrobeBake(locked, "sha256:body-A", "sha256:body-A", false, {
      plannedCacheKey: "key-after-garment-override",
      priorCacheKey: "key-before-garment-override",
    });
    expect(decision.bake).toBe(false);
    expect(decision.reason).toBe("locked_stale");
    expect(decision.stale).toBe(true);
  });

  /**
   * W5 (tsk_4100343a0be0b471): delete is a compile event, not a silent array
   * splice. A tombstoned wardrobe refuses to bake and is stale; a wardrobe
   * whose parent body is tombstoned goes stale (parent_tombstoned). A lock is
   * not a delete: a locked node is never tombstoned, and a node carrying both
   * keeps the lock's skip semantics.
   */
  it("W5: tombstoned wardrobe refuses to bake and is stale", () => {
    const report = buildEncounterMaterializationEvidenceReport({
      generatedAt: "2026-05-28T00:00:00.000Z",
      bundleReport: twoActorBundleFixture(),
    });
    const unsplit = emitCompileNodes(report).find((n) => n.nodeId === "actor:patient_maya_johnson_v1")!;
    const [, wardrobe] = splitCharacterBakers(unsplit);
    const tombstoned = {
      ...wardrobe,
      contentHash: "sha256:wardrobe-baked",
      tombstone: { deletedAt: "2026-08-30T00:00:00.000Z", removedBy: "faculty_remove" as const, removedNodeId: "actor:patient_maya_johnson_v1" },
    };
    const decision = planWardrobeBake(tombstoned, "sha256:body-A", "sha256:body-A");
    expect(decision.bake).toBe(false);
    expect(decision.reason).toBe("tombstoned");
    expect(decision.stale).toBe(true);
  });

  it("W5: tombstoned parent -> descendant wardrobe goes stale (parent_tombstoned)", () => {
    const report = buildEncounterMaterializationEvidenceReport({
      generatedAt: "2026-05-28T00:00:00.000Z",
      bundleReport: twoActorBundleFixture(),
    });
    const unsplit = emitCompileNodes(report).find((n) => n.nodeId === "actor:patient_maya_johnson_v1")!;
    const [, wardrobe] = splitCharacterBakers(unsplit);
    const baked = { ...wardrobe, contentHash: "sha256:wardrobe-baked" };
    const decision = planWardrobeBake(baked, "sha256:body-A", "sha256:body-A", true);
    expect(decision.bake).toBe(false);
    expect(decision.reason).toBe("parent_tombstoned");
    expect(decision.stale).toBe(true);
  });

  it("W5: locked + tombstoned keeps the lock's skip semantics, not a delete", () => {
    const report = buildEncounterMaterializationEvidenceReport({
      generatedAt: "2026-05-28T00:00:00.000Z",
      bundleReport: twoActorBundleFixture(),
    });
    const unsplit = emitCompileNodes(report).find((n) => n.nodeId === "actor:patient_maya_johnson_v1")!;
    const [, wardrobe] = splitCharacterBakers(unsplit);
    const lockedTombstoned = {
      ...wardrobe,
      contentHash: "sha256:wardrobe-baked",
      lock: { locked: true, lockKind: "faculty_keep_artifact" },
      tombstone: { deletedAt: "2026-08-30T00:00:00.000Z", removedBy: "faculty_remove" as const, removedNodeId: "actor:patient_maya_johnson_v1" },
    };
    const decision = planWardrobeBake(lockedTombstoned, "sha256:body-A", "sha256:body-A");
    expect(decision.bake).toBe(false);
    expect(decision.reason).toBe("locked_stale");
    expect(decision.stale).toBe(true);
  });
});

function twoActorBundleFixture(): GeneratedEdStationRuntimeBundleReport {
  const base = bundleReportFixture();
  const patient = base.actorHumanoidMaterializationContract!.actorVariants[0]!;
  return {
    ...base,
    actorHumanoidMaterializationContract: {
      ...base.actorHumanoidMaterializationContract!,
      sharedNeutralMeshReuseActorIds: ["patient_maya_johnson_v1", "parent_tara_johnson_v1"],
      actorVariants: [
        patient,
        {
          ...patient,
          actorId: "parent_tara_johnson_v1",
          actorRole: "family",
          variantSemanticKey: "peds_asthma_parent_anxiety_v1:parent_tara_johnson_v1:family:anny_humanoid_variant",
        },
      ],
    },
  };
}

function bundleReportFixture(): GeneratedEdStationRuntimeBundleReport {
  return {
    schemaVersion: "openclinxr.generated-ed-station-runtime-bundle.v1",
    generatedAt: "2026-05-28T00:00:00.000Z",
    status: "bundle_ready",
    bundle: null,
    learnerBundle: null,
    actorHumanoidMaterializationContract: {
      schemaVersion: "openclinxr.actor-humanoid-materialization-contract.v1",
      scenarioId: "peds_asthma_parent_anxiety_v1",
      source: "generated_station_runtime_bundle",
      actorSpecificVariantKeysRequired: true,
      sharedNeutralMeshReuseDetected: true,
      sharedNeutralMeshReuseActorIds: ["patient_maya_johnson_v1"],
      actorVariants: [{
        actorId: "patient_maya_johnson_v1",
        actorRole: "patient",
        modelAssetId: "openclinxr.peds.patient.generated-humanoid",
        variantSemanticKey: "peds_asthma_parent_anxiety_v1:patient_maya_johnson_v1:patient:anny_humanoid_variant",
        sourceBlobName: ".openclinxr/asset-production/ed-chest-pain/generated-human-rigging/neutral-generated-human.glb",
        humanoidVariantProfile: {
          ageBand: "child",
          bodyScale: "small_child",
          hairFaceRequired: true,
          clothingLayer: "patient_gown",
          faceEyeLipRigRequired: true,
          idlePoseRequired: true,
          locomotionRequired: true,
        },
        requiredMaterializationCueIds: [
          "actor_specific_body_profile_required",
          "actor_specific_clothing_required",
          "actor_specific_hair_face_required",
          "actor_specific_rig_preservation_required",
        ],
      }],
      materializationBlockers: ["shared_neutral_humanoid_reuse_blocks_actor_specific_asset_readiness"],
      caveats: ["Shared neutral humanoid reuse is local runtime scaffolding only."],
      recommendedNextAction: "materialize actor-specific Anny humanoid GLBs before treating visual role distinction as asset-level progress",
      notEvidenceFor: [...notEvidenceFor, "animation_quality"],
    },
    equipmentMaterializationContract: {
      schemaVersion: "openclinxr.equipment-materialization-contract.v1",
      scenarioId: "peds_asthma_parent_anxiety_v1",
      source: "generated_station_runtime_bundle",
      equipmentSpecificVariantKeysRequired: true,
      genericEquipmentReuseDetected: true,
      genericEquipmentReuseEquipmentIds: ["nebulizer_mask_equipment"],
      equipmentVariants: [{
        equipmentId: "nebulizer_mask_equipment",
        modelAssetId: "openclinxr.peds.nebulizer.generated-equipment",
        variantSemanticKey: "peds_asthma_parent_anxiety_v1:nebulizer_mask_equipment:equipment_materialization_variant",
        sourceBlobName: ".openclinxr/asset-production/ed-chest-pain/medical-equipment/ecg-cart-12-lead.glb",
        equipmentVariantProfile: {
          equipmentFamily: "nebulizer_mask",
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
      }],
      materializationBlockers: ["generic_equipment_reuse_blocks_equipment_specific_asset_readiness"],
      caveats: ["Generic equipment reuse is local runtime scaffolding only."],
      recommendedNextAction: "materialize equipment-specific generated GLBs or prefabs before treating pediatric equipment as Quest, clinical, scoring, or production-ready",
      notEvidenceFor,
    },
    bundleBlobName: null,
    runtimeAssetReviewDecisions: [],
    blockers: [],
    productionCloudCall: false,
    notEvidenceFor,
  };
}

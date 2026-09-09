import { buildGuardedRuntimeSelectorDisabledDecision, createEdChestPainLocalLearnerRuntimeAssetBundle } from "@openclinxr/asset-registry";
import { unrealizableEquipmentDecisions } from "@openclinxr/asset-registry/case-runtime-equipment";
import { routeById } from "@openclinxr/rest";
import { buildDynamicEncounterFactoryPlanningProjection, scenarioBank } from "@openclinxr/scenario-fixtures";
import { resolveScenarioById, type ScenarioCatalogPort } from "@openclinxr/scenario-runtime";
import { createRealtimeVoiceGatewayPosture, selectRealtimeVoiceProtocol } from "@openclinxr/voice-gateway";
import type { Hono } from "hono";
import type { ApiAppContext } from "../api-app-context.js";
import { checklist, isRawUiXrManualPerformancePayload, isRuntimeRealismEvidenceInputReviewDecision, isRuntimeVisualEvidenceAttachment, uniqueStrings } from "../api-route-support.js";
import { attachMaterializationAttachmentPlanSummary, attachMaterializationEvidenceAttachmentSummary, attachMaterializationInputManifestSummary, attachMaterializationInputReviewDecisionRecord, attachPedsHumanoidMaterializationHandoff, attachRuntimeEvidenceCaptureScaffold, attachRuntimeRealismEvidenceInputDraft, attachRuntimeRealismEvidenceInputReviewDecisionRecord, attachRuntimeVisualEvidenceAttachmentActionPacket, attachRuntimeVisualEvidenceAttachmentRecord, attachRuntimeVisualEvidenceAttachmentSummary, buildRuntimeRealismEvidenceAttachmentSummary, buildRuntimeRealismEvidenceInputReviewDecisionRecord, buildRuntimeVisualEvidenceAttachmentActionPacket, buildRuntimeVisualEvidenceAttachmentRecord, isRecord, readMaterializationAttachmentPlanSummaryForScenario, readMaterializationEvidenceAttachmentSummaryForScenario, readMaterializationInputManifestSummaryForScenario, readRepoGeneratedJsonIfExists, readRuntimeEvidenceCaptureScaffoldForScenario, realtimeVoiceProtocolPreference } from "../api-support.js";
import type { ApiAppVariables, ApiRuntimeVisualEvidenceAttachment } from "../api-types.js";

/** RuntimeEvidence domain routes (composition-root migration). */
export function registerRuntimeEvidenceRoutes(app: Hono<{ Variables: ApiAppVariables }>, ctx: ApiAppContext): void {
  const { persistence, realtimeVoiceGatewayPosture, sceneGenerationRequests, runtimeRealismEvidenceInputReviewDecisions, runtimeVisualEvidenceAttachments, latestMaterializationInputReviewDecisionRecordForScenario, latestMaterializationInputReviewDecisionRecordForPacket } = ctx;

  app.get(routeById("scenario-bank-dynamic-encounter-factory-planning").path, (context) =>
    context.json({
      ...buildDynamicEncounterFactoryPlanningProjection(scenarioBank),
      routeContractBoundary: routeById("scenario-bank-dynamic-encounter-factory-planning").contractBoundary,
    }),
  );

  app.get(routeById("runtime-selection-review-packet").path, (context) => {
    const inMemoryReviewScenarioId = ctx.state.runtimeVisualEvidenceAttachmentRecord?.scenarioId
      ?? ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord?.scenarioId
      ?? sceneGenerationRequests.find((candidate) => candidate.materializationInputReviewDecisionRecord)?.scenarioId;
    const durablePacket = readRepoGeneratedJsonIfExists(
      "docs/openclinxr/encounter-runtime-selection-review-packet-peds-asthma-parent-anxiety-2026-05-28.json",
    );
    if (durablePacket && (!inMemoryReviewScenarioId || inMemoryReviewScenarioId === "peds_asthma_parent_anxiety_v1")) {
      const durableRuntimeHandoff = readRepoGeneratedJsonIfExists(
        ".openclinxr/encounter-publication/encounter-runtime-handoff-peds-asthma-parent-anxiety-2026-08-28.json",
      );
      const encounterRuntimeHandoff = isRecord(durableRuntimeHandoff)
        && durableRuntimeHandoff["schemaVersion"] === "openclinxr.evidence-gated-runtime-handoff-adapter.v1"
        ? durableRuntimeHandoff
        : undefined;
      const packetWithSummary = attachMaterializationEvidenceAttachmentSummary(
        attachMaterializationAttachmentPlanSummary(
          attachMaterializationInputManifestSummary(attachRuntimeRealismEvidenceInputDraft(attachPedsHumanoidMaterializationHandoff(durablePacket))),
        ),
      );
      const packetWithRuntimeReviewRecord = attachRuntimeRealismEvidenceInputReviewDecisionRecord(packetWithSummary, ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord);
      const packetWithRuntimeEvidenceScaffold = attachMaterializationInputReviewDecisionRecord(
        attachRuntimeVisualEvidenceAttachmentRecord(
          attachRuntimeVisualEvidenceAttachmentActionPacket(
            attachRuntimeVisualEvidenceAttachmentSummary(packetWithRuntimeReviewRecord, ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord, ctx.state.runtimeVisualEvidenceAttachmentRecord),
            ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord,
            ctx.state.runtimeVisualEvidenceAttachmentRecord,
          ),
          ctx.state.runtimeVisualEvidenceAttachmentRecord,
        ),
        latestMaterializationInputReviewDecisionRecordForPacket(packetWithSummary),
      );
      const packet = attachRuntimeEvidenceCaptureScaffold(packetWithRuntimeEvidenceScaffold) as Record<string, unknown>;
      return context.json(encounterRuntimeHandoff ? { ...packet, encounterRuntimeHandoff } : packet);
    }

    const bundle = createEdChestPainLocalLearnerRuntimeAssetBundle();
    const materializationInputReviewDecisionRecord = latestMaterializationInputReviewDecisionRecordForScenario(bundle.scenarioId);
    const guardedRuntimeSelectorDecision = buildGuardedRuntimeSelectorDisabledDecision({
      selectedRuntimeAssetBundleId: bundle.bundleId,
      selectedScenarioId: bundle.scenarioId,
      selectedStationId: bundle.stationId,
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      candidateBundles: [bundle],
    });
    return context.json({
      generatedAt: "2026-05-25T00:00:00.000Z",
      schemaVersion: "openclinxr.encounter-runtime-selection-review-packet.v1",
      source: "api_local_runtime_bundle_fixture",
      selectedScenarioId: bundle.scenarioId,
      selectedEncounterId: "ed_chest_pain_local_encounter",
      selectedStationId: bundle.stationId,
      selectedRuntimeAssetBundleId: bundle.bundleId,
      reviewPacketMode: "read_only_guarded_runtime_handoff",
      handoffArtifactsInternallyPaired: true,
      runtimeCandidates: {
        model: "mock",
        voice: "mock",
      },
      guardedRuntimeSelectorDecision,
      publicationPayloadLinkage: {
        source: "encounter_publication_payloads",
        status: "blocked",
        blockers: ["humanoid_realism_requirement_actor_missing:family"],
        localMaterializationHandoff: {
          requestId: "encounter_assets_ed_chest_pain_priority_executable_v1",
          scenarioId: "ed_chest_pain_priority_v2",
          rootPath: ".openclinxr/encounter-factory/ed_chest_pain_priority_v2/encounter_assets_ed_chest_pain_priority_executable_v1",
          plannedOutputCount: 8,
          materializedOutputCount: 0,
          allOutputsPlannedMetadataOnly: true,
        },
        assetNeedsReadiness: {
          readyForDeterministicGeneration: true,
          missingRequiredAssetNeedIds: [],
          blockers: [],
          requiredHumanoidRoles: ["patient", "family", "nurse"],
          animationRequirementCount: 3,
          emotionRequirementCount: 3,
          gazeRequirementCount: 3,
          lipSyncRequirementCount: 3,
          sharedAssetLibrarySemanticKeyCount: 8,
        },
        realismEvidenceRefs: {
          claimBoundary: "metadata_only_not_runtime_or_visual_quality_evidence",
          refIds: ["humanoid-realism-gate", "runtime-realism-evidence-check", "visual-qa-evidence-check"],
          refs: [
            { refId: "humanoid-realism-gate", evidenceRef: "encounter-publication-realism://ed_chest_pain_priority_v2/encounter_assets_ed_chest_pain_priority_executable_v1/humanoid-realism-gate/0-actors", requiredBefore: "guarded_runtime_wiring", status: "required_not_attached", notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"] },
            { refId: "runtime-realism-evidence-check", evidenceRef: "encounter-publication-realism://ed_chest_pain_priority_v2/encounter_assets_ed_chest_pain_priority_executable_v1/runtime-realism-evidence-check/0-actors", requiredBefore: "guarded_runtime_wiring", status: "required_not_attached", notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"] },
            { refId: "visual-qa-evidence-check", evidenceRef: "encounter-publication-realism://ed_chest_pain_priority_v2/encounter_assets_ed_chest_pain_priority_executable_v1/visual-qa-evidence-check/0-actors", requiredBefore: "guarded_runtime_wiring", status: "required_not_attached", notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"] },
          ],
          requiredBefore: "guarded_runtime_wiring",
          runtimeExecutionAllowed: false,
          providerExecutionPerformed: false,
          questReadinessClaimed: false,
        },
      },
      operatorReviewReadiness: {
        status: "not_ready_for_operator_review",
        reviewedArtifactCount: 4,
        blockingArtifactCount: 4,
        blockerIds: [
          "runtime_selector_disabled_guard_not_wired",
          "publication_payload_not_materialized",
          "humanoid_realism_requirement_actor_missing:family",
          "runtime_selection_review_packet_api_surface_read_only",
        ],
        requiredOperatorActions: [
          "materialize_or_attach_generated_assets_before_guarded_runtime_wiring",
          "attach_humanoid_runtime_visual_qa_evidence_refs",
          "confirm_provider_execution_remains_disabled_until_explicit_approval",
          "confirm_runtime_selector_remains_disabled_until_evidence_gates_clear",
        ],
        materializationRequiredBeforeRuntime: true,
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        questEvidenceRefreshAllowed: false,
        claimBoundary: "operator_review_readiness_metadata_only",
      },
      materializationInputManifestSummary: readMaterializationInputManifestSummaryForScenario(bundle.scenarioId),
      materializationAttachmentPlanSummary: readMaterializationAttachmentPlanSummaryForScenario(bundle.scenarioId),
      materializationEvidenceAttachmentSummary: readMaterializationEvidenceAttachmentSummaryForScenario(bundle.scenarioId),
      materializationInputReviewDecisionRecord,
      runtimeRealismEvidenceInputReviewDecisionRecord: ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord,
      runtimeVisualEvidenceAttachmentSummary: ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord?.scenarioId === bundle.scenarioId
        ? buildRuntimeRealismEvidenceAttachmentSummary(ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord, ctx.state.runtimeVisualEvidenceAttachmentRecord)
        : undefined,
      runtimeVisualEvidenceAttachmentActionPacket: ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord?.scenarioId === bundle.scenarioId
        ? buildRuntimeVisualEvidenceAttachmentActionPacket(buildRuntimeRealismEvidenceAttachmentSummary(ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord, ctx.state.runtimeVisualEvidenceAttachmentRecord))
        : undefined,
      runtimeVisualEvidenceAttachmentRecord: ctx.state.runtimeVisualEvidenceAttachmentRecord?.scenarioId === bundle.scenarioId ? ctx.state.runtimeVisualEvidenceAttachmentRecord : undefined,
      runtimeEvidenceCaptureScaffold: readRuntimeEvidenceCaptureScaffoldForScenario(bundle.scenarioId),
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      providerExecutionPerformed: false,
      uiLaunchPerformed: false,
      questEvidenceRefreshed: false,
      broadVerificationPerformed: false,
      reviewerChecklist: [
        checklist("confirm_selector_guard_remains_disabled", ["runtime_selector_disabled_guard_not_wired"]),
        checklist("confirm_provider_execution_disabled", ["provider_execution_disabled_by_policy"]),
        checklist("confirm_learner_launch_blocked", ["learner_launch_disabled_until_evidence_gates_clear"]),
        checklist("confirm_no_readiness_claims", []),
      ],
      blockers: uniqueStrings([
        ...guardedRuntimeSelectorDecision.blockers,
        "publication_payload_not_materialized",
        "humanoid_realism_requirement_actor_missing:family",
        "runtime_selection_review_packet_api_surface_read_only",
      ]),
      nextAllowedStep: "review_publication_materialization_blockers_before_guarded_wiring",
      claimBoundary: "runtime_selection_review_packet_not_runtime_execution",
      notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
    });
  });

  app.post(routeById("submit-runtime-realism-evidence-input-review").path, async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as { scenarioId?: unknown; decisions?: unknown };
    const scenarioId = typeof body.scenarioId === "string" ? body.scenarioId : "peds_asthma_parent_anxiety_v1";
    const decisions = Array.isArray(body.decisions) ? body.decisions.filter(isRuntimeRealismEvidenceInputReviewDecision) : [];
    runtimeRealismEvidenceInputReviewDecisions.push(...decisions);
    ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord = buildRuntimeRealismEvidenceInputReviewDecisionRecord({
      scenarioId,
      decisions: runtimeRealismEvidenceInputReviewDecisions,
    });
    return context.json(ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord);
  });

  app.post(routeById("submit-runtime-visual-evidence-attachment").path, async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as { scenarioId?: unknown; attachments?: unknown };
    const scenarioId = typeof body.scenarioId === "string" ? body.scenarioId : ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord?.scenarioId ?? "peds_asthma_parent_anxiety_v1";
    if (isRecord(body) && isRawUiXrManualPerformancePayload(body)) {
      return context.json({
        error: "raw_ui_xr_payload_not_accepted",
        scenarioId,
        acceptedBodyRef: "submitRuntimeVisualEvidenceAttachmentInput",
        rawPayloadDisplayed: false,
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        productionAssetReadinessClaimed: false,
        clinicalValidityClaimed: false,
        scoringValidityClaimed: false,
        claimBoundary: "runtime_visual_evidence_attachment_route_rejects_raw_ui_xr_payloads",
      }, 400);
    }
    if (!ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord || ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord.scenarioId !== scenarioId) {
      return context.json({ error: "runtime_realism_evidence_input_review_required", scenarioId }, 400);
    }
    const actionPacket = buildRuntimeVisualEvidenceAttachmentActionPacket(
      buildRuntimeRealismEvidenceAttachmentSummary(ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord, undefined),
    );
    const reviewedInputIds = new Set(ctx.state.runtimeRealismEvidenceInputReviewDecisionRecord.decisions
      .filter((decision) => decision.decision === "reviewed_metadata_only")
      .map((decision) => decision.inputId));
    const allowedActionIds = new Set(actionPacket?.availableActions.map((action) => action.actionId) ?? []);
    const attachments = Array.isArray(body.attachments)
      ? body.attachments.filter((attachment): attachment is ApiRuntimeVisualEvidenceAttachment =>
        isRuntimeVisualEvidenceAttachment(attachment)
        && allowedActionIds.has(attachment.actionId)
        && reviewedInputIds.has(attachment.inputId)
        && (
          (attachment.actionId === "attach_runtime_realism_evidence_refs" && attachment.inputKind === "runtime_realism_signal_input")
          || (attachment.actionId === "attach_visual_qa_evidence_refs" && attachment.inputKind === "visual_qa_review_input")
        ))
      : [];
    runtimeVisualEvidenceAttachments.push(...attachments);
    ctx.state.runtimeVisualEvidenceAttachmentRecord = buildRuntimeVisualEvidenceAttachmentRecord({
      scenarioId,
      attachments: runtimeVisualEvidenceAttachments,
    });
    return context.json(ctx.state.runtimeVisualEvidenceAttachmentRecord);
  });

  app.get(routeById("learner-runtime-asset-bundle-list").path, async (context) => {
    const fallbackBundle = createEdChestPainLocalLearnerRuntimeAssetBundle();
    const persistedBundles = await persistence.listLearnerRuntimeAssetBundles?.() ?? [];
    const bundleSummaries = [fallbackBundle, ...persistedBundles]
      .filter((bundle, index, bundles) => bundles.findIndex((candidate) => candidate.bundleId === bundle.bundleId) === index)
      .map((bundle) => ({
        bundleId: bundle.bundleId,
        scenarioId: bundle.scenarioId,
        stationId: bundle.stationId,
        identityScope: bundle.identityScope,
        actorCount: bundle.actors.length,
        equipmentCount: bundle.equipment.length,
        retrievalMode: bundle.bundleId === fallbackBundle.bundleId ? "local_fixture_fallback" : "persistence_sink",
      }));

    return context.json({
      bundles: bundleSummaries,
      productionCloudCall: false,
      notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
    });
  });

  app.get(routeById("learner-runtime-asset-bundle").path, async (context) => {
    const bundleId = context.req.param("bundleId");
    const persistedBundle = await persistence.getLearnerRuntimeAssetBundle?.(bundleId);
    if (persistedBundle) {
      return context.json({
        ...persistedBundle,
        retrievalMode: "persistence_sink",
        productionCloudCall: false,
      });
    }

    // The learner selects a SCENARIO, not a bundle — `apps/ui-xr/src/main.ts:1018-1026` reads
    // `?scenarioId=` and hands it to the same constructor called below.
    //
    // THIS ROUTE USED TO DISCARD THE SELECTION ENTIRELY: it read no scenario parameter and called
    // the constructor with NO ARGUMENTS, so a persisted, reviewed case was served the ED bundle,
    // ED scenarioId and ED cast together. Resolving the selection authored-first through the
    // EXISTING ScenarioCatalogPort is what fixes that. (A SECOND, separate defect lives in the
    // constructor: given an id and nothing else it falls back to the ED literals for any case the
    // in-repo bank does not carry — see actor-casting.ts:294. Passing the resolved DOCUMENT, not
    // just the id, is what avoids it here.)
    //
    // An id nothing resolves REFUSES rather than defaulting to the ED bay.
    const selectedScenarioId = context.req.query("scenarioId")?.trim();
    const port: ScenarioCatalogPort = {};
    if (persistence.getAuthoredScenario) {
      port.getAuthoredScenario = persistence.getAuthoredScenario.bind(persistence);
    }
    const selected = selectedScenarioId ? await resolveScenarioById(selectedScenarioId, port) : undefined;
    if (selectedScenarioId && !selected) {
      return context.json({ error: "scenario_not_found", scenarioId: selectedScenarioId, productionCloudCall: false }, 404);
    }

    // An equipment decision the bundle cannot act on REFUSES here. A case that believes it has
    // refused an ECG cart, and has actually refused nothing, is the same silence this route exists
    // to remove — so an unreviewable decision is named rather than served past.
    const unrealizable = selected ? unrealizableEquipmentDecisions(selected.scenario) : [];
    if (unrealizable.length > 0) {
      return context.json({
        error: "unrealizable_equipment_decision",
        scenarioId: selected?.scenario.scenarioId,
        unrealizableEquipmentDecisions: unrealizable,
        productionCloudCall: false,
      }, 422);
    }

    const fallbackBundle = createEdChestPainLocalLearnerRuntimeAssetBundle(
      selected ? { scenarioId: selected.scenario.scenarioId, scenario: selected.scenario } : {},
    );
    if (bundleId !== fallbackBundle.bundleId && bundleId !== "ed_chest_pain_local_encounter") {
      return context.json({
        error: "asset_bundle_not_found",
        fallbackBundleId: fallbackBundle.bundleId,
        productionCloudCall: false,
      }, 404);
    }
    return context.json({
      ...fallbackBundle,
      retrievalMode: "local_fixture_fallback",
      ...(selected ? { scenarioCatalogSource: selected.catalogSource } : {}),
      productionCloudCall: false,
    });
  });

  app.get(routeById("realtime-voice-posture").path, (context) => {
    const posture = createRealtimeVoiceGatewayPosture(realtimeVoiceGatewayPosture);
    return context.json({
      ...posture,
      recommendedProtocolSelection: selectRealtimeVoiceProtocol(posture, {
        preferredProtocolLaneIds: realtimeVoiceProtocolPreference,
        requireMedia: true,
      }),
    });
  });

}

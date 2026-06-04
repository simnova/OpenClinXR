import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  EncounterDynamicBehaviorCoverageSummary,
  EncounterFactoryDryRunSummary,
  EncounterRuntimeSceneManifest,
  LearnerRuntimeAssetBundle,
} from "../../../packages/openclinxr/asset-registry/src/runtime-bundles.js";
import {
  buildEncounterDynamicBehaviorCoverageSummary,
  buildEncounterFactoryDryRunSummary,
  buildEncounterFactorySummaryContracts,
  ENCOUNTER_HUMANOID_RUNTIME_REQUIRED_SIGNAL_IDS,
} from "../../../packages/openclinxr/asset-registry/src/runtime-bundles.js";
import type {
  EncounterGenerationWorkOrder,
  EncounterHumanoidRealismRequirements,
  EncounterWorkerMaterializationPlan,
} from "../../../packages/openclinxr/capability-gateway/src/index.js";
import {
  buildEncounterAssetGenerationPublicationTargets,
  buildEncounterWorkerMaterializationPlan,
  type EncounterAssetGenerationPublicationTargets,
} from "../../../packages/openclinxr/capability-gateway/src/index.js";
import type { DynamicEncounterFactoryProjectionArtifact } from "../../../packages/openclinxr/shared-schemas/src/index.js";
import { validateDynamicEncounterFactoryProjectionArtifact } from "../../../packages/openclinxr/shared-schemas/src/index.js";
import { globFiles, readJson, writeJson } from "../../agent-factory/lib.js";
import {
  buildEncounterOperationalBoundaryNotes,
  type EncounterOperationalBoundaryNotes,
  validateEncounterOperationalBoundaryNotes,
} from "../evidence/provider-boundary-notes.js";
import type { EncounterAssetGenerationQueueReport } from "./encounter-asset-generation-queue.js";
import { buildEncounterAssetGenerationQueueReport } from "./encounter-asset-generation-queue.js";
import type { EncounterMaterializationEvidenceReport } from "./encounter-materialization-evidence.js";
import type { EncounterMaterializationEvidenceAttachmentRecords } from "./encounter-materialization-evidence-attachments.js";
import type { GeneratedEdStationRuntimeBundleReport } from "./generated-ed-station-runtime-bundle.js";
import type { VisualQaRemediationWorkOrderRef } from "./visual-qa-evidence-check.js";

type CliOptions = {
  queueReportPath?: string;
  projectionArtifactPath?: string;
  bundleReportPath?: string;
  materializationEvidenceReportPath?: string;
  materializationEvidenceAttachmentsPath?: string;
  outputPath?: string;
  validatePath?: string;
  summarizeDryRunPlanPath?: string;
  validateLatest: boolean;
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

export type EncounterPublicationPayloadReport = {
  generatedAt: string;
  schemaVersion: "openclinxr.encounter-publication-payloads.v1";
  status: "materialized" | "blocked";
  requestId: string;
  scenarioId: string;
  stationId: string;
  publicationTargets: EncounterAssetGenerationPublicationTargets;
  localArtifacts: {
    sceneManifestPath: string;
    learnerRuntimeBundlePath: string;
    uiXrPublicSceneManifestPath: string;
    uiXrPublicLearnerRuntimeBundlePath: string;
  };
  payloadSummary: {
    sceneManifestId: string;
    roomPropCount: number;
    learnerBundleId: string;
    actorCount: number;
    humanoidRequirementActorCount: number;
    humanoidRuntimeRequirementActorCount: number;
    humanoidRealismProfileCount: number;
    equipmentCount: number;
    uiSurfaceCount: number;
  };
  humanoidRealismRequirements: EncounterHumanoidRealismRequirements;
  humanoidRealismProfiles: EncounterAssetGenerationQueueReport["humanoidRealismProfiles"];
  humanoidRuntimeRequirements: EncounterPublicationHumanoidRuntimeRequirement[];
  caseDefinedHumanoidRuntimeHandoff: EncounterPublicationCaseDefinedHumanoidRuntimeHandoff[];
  actorEquipmentMaterializationGate: EncounterPublicationActorEquipmentMaterializationGate;
  caseDefinitionDrivenFactoryCoverage: EncounterPublicationCaseDefinitionDrivenFactoryCoverage;
  realismEvidenceRefs: EncounterPublicationRealismEvidenceRefs;
  dynamicEncounterBehaviorCoverage: EncounterDynamicBehaviorCoverageSummary;
  encounterAssetNeedsReadinessManifest?: EncounterAssetGenerationQueueReport["encounterAssetNeedsReadinessManifest"];
  encounterFactoryDryRunPlan: EncounterFactoryDryRunPlan;
  localMaterializationHandoffManifest: EncounterWorkerMaterializationPlan;
  operationalNotes: EncounterOperationalBoundaryNotes;
  projectionArtifactConsumption?: EncounterAssetGenerationQueueReport["projectionArtifactConsumption"];
  remediationWorkOrderRefs?: VisualQaRemediationWorkOrderRef[];
  evidenceBoundaries: {
    localPayloadsMaterialized: boolean;
    dynamicEncounterPayload: true;
    runtimeHardcodingRequired: false;
    azureCloudOperationPerformed: false;
    mongoWritePerformed: false;
    paidApisUsed: false;
    productionReadinessClaimed: false;
    questReadinessClaimed: false;
    clinicalValidityClaimed: false;
    scoringValidityClaimed: false;
  };
  blockers: string[];
};

export type EncounterFactoryDryRunPlan = {
  schemaVersion: "openclinxr.encounter-factory-dry-run-plan.v1";
  planId: string;
  status: "review_plan_created_not_asset_generation" | "blocked_pending_runtime_bundle";
  sourceRequestId: string;
  sourceScenarioId: string;
  actorRoles: string[];
  stageCount: number;
  generationWorkOrders: EncounterGenerationWorkOrder[];
  stages: Array<{
    stageId: string;
    inputRefs: string[];
    outputRefs: string[];
    reviewGateIds: string[];
    status: "planned_metadata_only" | "blocked_pending_runtime_bundle";
  }>;
  reviewPosture: {
    requiredReviewerRoles: Array<"asset_pipeline" | "clinical_simulation" | "xr_performance" | "security_privacy">;
    nextAction: "review_factory_plan_before_generation_or_publication" | "resolve_bundle_blockers_before_factory_plan_review";
    claimBoundary: "encounter_factory_dry_run_not_asset_generation";
  };
  evidenceBoundaries: {
    metadataOnlyPlan: true;
    generatedAssetsMaterialized: false;
    runtimeBundlePublished: false;
    learnerRuntimeEnabled: false;
    questReadinessClaimed: false;
    productionReadinessClaimed: false;
  } & EncounterFactoryDryRunEvidenceBoundaries;
};

export type EncounterFactoryDryRunPlanSummary = EncounterFactoryDryRunSummary;

type EncounterFactoryDryRunEvidenceBoundaries = EncounterFactoryDryRunSummary["evidenceBoundaries"];

export type EncounterPublicationHumanoidRuntimeRequirement = {
  actorId: string;
  actorRole: string;
  modelAssetId: string;
  requiredAssetKinds: string[];
  requiredSignalIds: string[];
  gazeTargetRequired: true;
  visemeMapRequired: true;
  notEvidenceFor: [
    "production_asset_readiness",
    "quest_readiness",
    "clinical_validity",
    "scoring_validity",
  ];
};

export type EncounterPublicationCaseDefinedHumanoidRuntimeHandoff = {
  claimBoundary: "case_definition_humanoid_runtime_handoff_metadata_only";
  actorRole: string;
  humanoidVariantProfile: {
    bodyScaleSource: "scenario_actor_role_and_factory_work_order";
    clothingLayer: "patient_gown" | "clinical_scrubs" | "civilian_family" | "role_specific";
    hairFaceRequired: true;
    faceEyeLipRigRequired: true;
    idlePoseRequired: true;
    locomotionRequired: boolean;
  };
  workOrderIds: string[];
  locomotionRequired: boolean;
  expressionRequired: boolean;
  gazeRequired: boolean;
  lipSyncRequired: boolean;
  interactiveRequired: boolean;
  requiredSignalIds: string[];
  blockers: [
    "runtime_realism_evidence_not_attached_to_encounter_bundle",
    "visual_qa_evidence_not_attached_to_encounter_bundle",
  ];
  notEvidenceFor: Array<"generated_humanoid_asset_readiness" | "animation_quality" | "quest_readiness" | "runtime_readiness" | "clinical_validity" | "scoring_validity">;
};

export type EncounterPublicationActorEquipmentMaterializationGate = {
  schemaVersion: "openclinxr.actor-equipment-materialization-gate.v1";
  claimBoundary: "materialization_contract_metadata_only_not_runtime_readiness";
  source: "generated_station_runtime_bundle_materialization_contracts";
  runtimeSelectionBlockedUntilEvidenceAttached: boolean;
  actorGate: {
    actorSpecificVariantKeysRequired: boolean;
    sharedNeutralMeshReuseDetected: boolean;
    actorVariantCount: number;
    actorRoles: string[];
    materializationBlockers: string[];
    caveats: string[];
    recommendedNextAction: string;
  };
  equipmentGate: {
    equipmentSpecificVariantKeysRequired: boolean;
    genericEquipmentReuseDetected: boolean;
    equipmentVariantCount: number;
    equipmentIds: string[];
    materializationBlockers: string[];
    caveats: string[];
    recommendedNextAction: string;
  };
  combinedBlockers: string[];
  combinedCaveats: string[];
  notEvidenceFor: Array<"runtime_readiness" | "quest_readiness" | "production_asset_readiness" | "clinical_validity" | "scoring_validity">;
  materializationEvidenceAttachment?: {
    source: "encounter_materialization_evidence_report";
    reportStatus: EncounterMaterializationEvidenceReport["status"];
    attachableToRuntimeSelection: boolean;
    actorRequiredEvidenceRefs: string[];
    equipmentRequiredEvidenceRefs: string[];
    blockers: string[];
    claimBoundary: "materialization_evidence_attachment_contract_not_runtime_readiness";
  };
  materializationEvidenceAttachmentSummary?: {
    source: "encounter_materialization_evidence_attachments";
    totalRequiredSlotCount: number;
    attachedSlotCount: number;
    missingSlotCount: number;
    heldOrInvalidAttachmentCount: number;
    allRequiredSlotsSatisfied: boolean;
    blockers: string[];
    runtimeSelectionAllowed: false;
    learnerLaunchAllowed: false;
    questEvidenceRefreshAllowed: false;
    claimBoundary: "metadata_only_materialization_evidence_attachment_summary";
  };
  remainingRuntimeBlockerReasons: {
    source: "materialization_attachment_summary_and_publication_runtime_gates";
    materializationEvidenceComplete: boolean;
    runtimeSelectionAllowed: false;
    learnerLaunchAllowed: false;
    questEvidenceRefreshAllowed: false;
    categories: Array<{
      category: "runtime_selector" | "runtime_realism" | "visual_qa" | "quest_evidence" | "metadata_only_assets";
      blockerIds: string[];
      recommendedNextAction: string;
    }>;
    claimBoundary: "remaining_runtime_blockers_after_materialization_metadata_only";
  };
};

export type EncounterPublicationRealismEvidenceRefs = {
  schemaVersion: "openclinxr.encounter-publication-realism-evidence-refs.v1";
  claimBoundary: "metadata_only_not_runtime_or_visual_quality_evidence";
  refs: Array<{
    refId: "humanoid-realism-gate" | "runtime-realism-evidence-check" | "visual-qa-evidence-check";
    evidenceRef: string;
    requiredBefore: "guarded_runtime_wiring";
    status: "required_not_attached";
      notEvidenceFor: Array<"production_asset_readiness" | "quest_readiness" | "clinical_validity" | "scoring_validity">;
  }>;
  runtimeRealismEvidenceHooks: Array<{
    actorId: string;
    actorRole: string;
    requiredSignalIds: string[];
    evidenceRef: string;
    status: "required_not_attached";
    claimBoundary: "runtime_realism_hook_metadata_only_not_runtime_readiness";
  }>;
  visualQaEvidenceHooks: Array<{
    targetId: string;
    targetKind: "humanoid_actor" | "equipment";
    requiredReviewFocus: Array<"face_gaze_lip_sync_expression" | "locomotion_pose" | "equipment_scale_placement_affordance">;
    evidenceRef: string;
    status: "required_not_attached";
    claimBoundary: "visual_qa_hook_metadata_only_not_visual_quality_evidence";
  }>;
  runtimeExecutionAllowed: false;
  providerExecutionPerformed: false;
  questReadinessClaimed: false;
};

export type EncounterPublicationCaseDefinitionDrivenFactoryCoverage = {
  schemaVersion: "openclinxr.case-definition-driven-factory-coverage.v1";
  claimBoundary: "metadata_only_case_definition_to_runtime_bundle_alignment";
  scenarioId: string;
  source: "scenario_definition_and_dialogue_seed_bank" | "unknown";
  scenarioStatus: string | null;
  requiredActorRoles: string[];
  learnerBundleActorRoles: string[];
  requiredTraceTags: string[];
  learnerBundleTraceTags: string[];
  requiredAssetNeedIds: string[];
  workOrderLookupRefs: string[];
  requiredEquipmentAssetNeedIds: string[];
  learnerBundleEquipmentIds: string[];
  coverage: {
    actorRolesCovered: boolean;
    traceTagsCovered: boolean;
    equipmentPlacementsPresent: boolean;
    assetNeedsCarriedByWorkOrders: boolean;
  };
  blockers: string[];
  notEvidenceFor: Array<"production_asset_readiness" | "quest_readiness" | "clinical_validity" | "scoring_validity">;
};

const defaultOutputPath = `docs/openclinxr/encounter-publication-payloads-${new Date().toISOString().slice(0, 10)}.json`;

async function main(): Promise<void> {
  await runEncounterPublicationPayloadsCli(process.argv.slice(2));
}

export async function runEncounterPublicationPayloadsCli(args: string[]): Promise<void> {
  const options = parseArgs(args);
  if (options.summarizeDryRunPlanPath) {
    console.log(JSON.stringify(summarizeEncounterFactoryDryRunPlan(await readJson<EncounterPublicationPayloadReport>(options.summarizeDryRunPlanPath)), null, 2));
    return;
  }
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestPath("docs/openclinxr/encounter-publication-payloads-*.json");
    if (!validatePath) throw new Error("Missing encounter publication payload report to validate.");
    const validation = validateEncounterPublicationPayloadReport(await readJson<unknown>(validatePath));
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }
    for (const error of validation.errors) console.error(error);
    process.exitCode = 1;
    return;
  }

  const projectionArtifact = options.projectionArtifactPath
    ? await readJson<unknown>(options.projectionArtifactPath)
    : undefined;
  if (projectionArtifact) {
    const validation = validateDynamicEncounterFactoryProjectionArtifact(projectionArtifact);
    if (!validation.ok) {
      for (const error of validation.errors) {
        console.error(error);
      }
      throw new Error(`Invalid projection artifact: ${options.projectionArtifactPath}`);
    }
  }

  if (options.queueReportPath && options.projectionArtifactPath) {
    throw new Error("Use either --queue-report or --projection-artifact, not both.");
  }

  const queueReport = projectionArtifact
    ? buildEncounterAssetGenerationQueueReport({
      projectionArtifact: projectionArtifact as DynamicEncounterFactoryProjectionArtifact,
    })
    : undefined;

  const queueReportPath = options.queueReportPath ?? await latestPath("docs/openclinxr/encounter-asset-generation-queue-*.json");
  const bundleReportPath = options.bundleReportPath ?? await latestPath("docs/openclinxr/generated-ed-station-runtime-bundle-*.json");
  if (!queueReport && !queueReportPath) {
    throw new Error("Missing queue report. Run asset:encounter-queue:plan first.");
  }
  if (!bundleReportPath) throw new Error("Missing generated bundle report. Run asset:generated-station-bundle first.");

  const materializationEvidenceReport = options.materializationEvidenceReportPath
    ? await readJson<EncounterMaterializationEvidenceReport>(options.materializationEvidenceReportPath)
    : undefined;
  const materializationEvidenceAttachments = options.materializationEvidenceAttachmentsPath
    ? await readJson<EncounterMaterializationEvidenceAttachmentRecords>(options.materializationEvidenceAttachmentsPath)
    : undefined;
  const report = await buildEncounterPublicationPayloadReport({
    queueReport: queueReport
      ? queueReport
      : await readJson<EncounterAssetGenerationQueueReport>(queueReportPath ?? ""),
    bundleReport: await readJson<GeneratedEdStationRuntimeBundleReport>(bundleReportPath),
    materializationEvidenceReport,
    materializationEvidenceAttachments,
  });
  await syncPublishedLearnerRuntimeMaterializationGate(report);
  await writeJson(options.outputPath ?? defaultOutputPath, report);
  console.log(`Wrote ${options.outputPath ?? defaultOutputPath}`);
}

async function syncPublishedLearnerRuntimeMaterializationGate(report: EncounterPublicationPayloadReport): Promise<void> {
  const paths = [
    report.localArtifacts.learnerRuntimeBundlePath,
    report.localArtifacts.uiXrPublicLearnerRuntimeBundlePath,
  ];
  for (const bundlePath of paths) {
    try {
      const bundle = await readJson<Record<string, unknown>>(bundlePath);
      bundle.actorEquipmentMaterializationGate = report.actorEquipmentMaterializationGate;
      await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
    } catch {
      // Blocked publication reports may not have emitted learner runtime bundle files yet.
    }
  }
}

export async function buildEncounterPublicationPayloadReport(input: {
  queueReport: EncounterAssetGenerationQueueReport;
  bundleReport: GeneratedEdStationRuntimeBundleReport;
  materializationEvidenceReport?: EncounterMaterializationEvidenceReport;
  materializationEvidenceAttachments?: EncounterMaterializationEvidenceAttachmentRecords;
  generatedAt?: string;
  artifactRoot?: string;
  remediationWorkOrderRefs?: VisualQaRemediationWorkOrderRef[];
}): Promise<EncounterPublicationPayloadReport> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const targets = buildEncounterAssetGenerationPublicationTargets(input.queueReport.request);
  const artifactRoot = input.artifactRoot ?? ".openclinxr/encounter-publication";
  const localPrefix = path.join(
    artifactRoot,
    input.queueReport.request.tenantId,
    input.queueReport.request.scenarioId,
    input.queueReport.request.encounterId,
  );
  const sceneManifestPath = path.join(localPrefix, "scene-manifest.v1.json");
  const learnerRuntimeBundlePath = path.join(localPrefix, "learner-runtime-bundle.v1.json");
  const publicPrefix = path.join("apps/ui-xr/public/xr-assets/generated", input.queueReport.request.scenarioId);
  const uiXrPublicSceneManifestPath = path.join(publicPrefix, "scene-manifest.v1.json");
  const uiXrPublicLearnerRuntimeBundlePath = path.join(publicPrefix, "learner-runtime-bundle.v1.json");
  const humanoidRealismRequirements = input.queueReport.humanoidRealismRequirements ?? deriveHumanoidRealismRequirementsFromBundle(input.bundleReport);
  const encounterAssetNeedsReadinessManifest = input.queueReport.encounterAssetNeedsReadinessManifest;
  const manifestBlockers = collectEncounterAssetNeedsReadinessBlockers(encounterAssetNeedsReadinessManifest);
  const remediationWorkOrderRefs = input.remediationWorkOrderRefs
    ?? await latestVisualQaRemediationWorkOrderRefsForScenario(input.queueReport.request.scenarioId);

  if (input.bundleReport.status !== "bundle_ready" || !input.bundleReport.learnerBundle) {
    return blockedReport({
      generatedAt,
      input,
      humanoidRealismRequirements,
      encounterAssetNeedsReadinessManifest,
      targets,
      sceneManifestPath,
      learnerRuntimeBundlePath,
      uiXrPublicSceneManifestPath,
      uiXrPublicLearnerRuntimeBundlePath,
      bundleReport: input.bundleReport,
      blockers: uniqueStrings([
        ...(input.bundleReport.blockers.length > 0 ? input.bundleReport.blockers : ["generated_bundle_not_ready"]),
        ...manifestBlockers,
      ]),
      ...(remediationWorkOrderRefs?.length ? { remediationWorkOrderRefs } : {}),
    });
  }

  const learnerBundle = input.bundleReport.learnerBundle;
  if (learnerBundle.scenarioId !== input.queueReport.request.scenarioId) {
    return blockedReport({
      generatedAt,
      input,
      humanoidRealismRequirements,
      encounterAssetNeedsReadinessManifest,
      targets,
      sceneManifestPath,
      learnerRuntimeBundlePath,
      uiXrPublicSceneManifestPath,
      uiXrPublicLearnerRuntimeBundlePath,
      bundleReport: input.bundleReport,
      blockers: [
        `scenario_mismatch:queue=${input.queueReport.request.scenarioId}:bundle=${learnerBundle.scenarioId}`,
        ...manifestBlockers,
      ],
      ...(remediationWorkOrderRefs?.length ? { remediationWorkOrderRefs } : {}),
    });
  }
  const caseDefinedHumanoidRuntimeHandoff = buildCaseDefinedHumanoidRuntimeHandoff(input.queueReport.plan.generationWorkOrders);
  const sceneManifest = attachCaseDefinedHumanoidRuntimeHandoff(
    learnerBundle.sceneManifest,
    caseDefinedHumanoidRuntimeHandoff,
  );
  const actorEquipmentMaterializationGate = buildActorEquipmentMaterializationGate(input.bundleReport, input.materializationEvidenceReport, input.materializationEvidenceAttachments);
  const learnerRuntimeBundlePayload = {
    ...learnerBundle,
    sceneManifest,
    actorEquipmentMaterializationGate,
  };
  const caseDefinitionDrivenFactoryCoverage = buildCaseDefinitionDrivenFactoryCoverage({
    queueReport: input.queueReport,
    learnerBundle,
  });
  const humanoidRealismProfiles = deriveHumanoidRealismProfiles(input.queueReport, humanoidRealismRequirements);
  const humanoidRuntimeRequirements = buildHumanoidRuntimeRequirements(learnerBundle, humanoidRealismRequirements);
  const missingHumanoidRequirementActorRoles = humanoidRealismRequirements.requirements
    .map((requirement) => requirement.actorRole)
    .filter((actorRole) => !learnerBundle.actors.some((actor) => actor.role === actorRole));
  if (missingHumanoidRequirementActorRoles.length > 0) {
    return blockedReport({
      generatedAt,
      input,
      humanoidRealismRequirements,
      encounterAssetNeedsReadinessManifest,
      targets,
      sceneManifestPath,
      learnerRuntimeBundlePath,
      uiXrPublicSceneManifestPath,
      uiXrPublicLearnerRuntimeBundlePath,
      blockers: [
        ...missingHumanoidRequirementActorRoles.map((actorRole) => `humanoid_realism_requirement_actor_missing:${actorRole}`),
        ...manifestBlockers,
      ],
      ...(remediationWorkOrderRefs?.length ? { remediationWorkOrderRefs } : {}),
    });
  }
  await mkdir(localPrefix, { recursive: true });
  await mkdir(publicPrefix, { recursive: true });
  await writeFile(sceneManifestPath, `${JSON.stringify(sceneManifest, null, 2)}\n`, "utf8");
  await writeFile(learnerRuntimeBundlePath, `${JSON.stringify(learnerRuntimeBundlePayload, null, 2)}\n`, "utf8");
  await writeFile(uiXrPublicSceneManifestPath, `${JSON.stringify(sceneManifest, null, 2)}\n`, "utf8");
  await writeFile(uiXrPublicLearnerRuntimeBundlePath, `${JSON.stringify(learnerRuntimeBundlePayload, null, 2)}\n`, "utf8");
  const encounterFactorySummary = buildEncounterFactorySummaryContracts({
    requestId: input.queueReport.request.requestId,
    scenarioId: input.queueReport.request.scenarioId,
    learnerRuntimeBundle: learnerBundle,
    actorRoles: humanoidRealismRequirements.requirements.map((requirement) => requirement.actorRole),
    requiredActorRoles: humanoidRealismRequirements.requirements.map((requirement) => requirement.actorRole),
    dynamicBehaviorCoverage: buildEncounterDynamicBehaviorCoverageSummary({
      learnerRuntimeBundle: learnerBundle,
      requiredActorRoles: humanoidRealismRequirements.requirements.map((requirement) => requirement.actorRole),
      scenarioId: input.queueReport.request.scenarioId,
    }),
  });

  return {
    generatedAt,
    schemaVersion: "openclinxr.encounter-publication-payloads.v1",
    status: "materialized",
    requestId: input.queueReport.request.requestId,
    scenarioId: input.queueReport.request.scenarioId,
    stationId: input.queueReport.request.stationId,
    publicationTargets: targets,
    localArtifacts: {
      sceneManifestPath,
      learnerRuntimeBundlePath,
      uiXrPublicSceneManifestPath,
      uiXrPublicLearnerRuntimeBundlePath,
    },
    payloadSummary: summarizePayloads(sceneManifest, learnerBundle, humanoidRealismRequirements, humanoidRealismProfiles),
    humanoidRealismRequirements,
    humanoidRealismProfiles,
    encounterAssetNeedsReadinessManifest,
    humanoidRuntimeRequirements,
    caseDefinedHumanoidRuntimeHandoff,
    actorEquipmentMaterializationGate,
    caseDefinitionDrivenFactoryCoverage,
    realismEvidenceRefs: buildPublicationRealismEvidenceRefs({
      requestId: input.queueReport.request.requestId,
      scenarioId: input.queueReport.request.scenarioId,
      humanoidRuntimeRequirements,
      equipmentIds: learnerBundle.equipment.map((equipment) => equipment.equipmentId),
    }),
    dynamicEncounterBehaviorCoverage: encounterFactorySummary.dynamicBehaviorCoverage,
    encounterFactoryDryRunPlan: buildEncounterFactoryDryRunPlan({
      queueReport: input.queueReport,
      humanoidRealismProfiles,
      humanoidRuntimeRequirements,
      blocked: false,
    }),
    localMaterializationHandoffManifest: buildEncounterWorkerMaterializationPlan({
      request: input.queueReport.request,
      workOrders: input.queueReport.plan.generationWorkOrders,
    }),
    ...(remediationWorkOrderRefs?.length ? { remediationWorkOrderRefs } : {}),
    ...(input.queueReport.projectionArtifactConsumption
      ? { projectionArtifactConsumption: input.queueReport.projectionArtifactConsumption }
      : {}),
    operationalNotes: buildEncounterOperationalBoundaryNotes(),
    evidenceBoundaries: boundary({ localPayloadsMaterialized: true }),
    blockers: [],
  };
}

export function summarizeEncounterFactoryDryRunPlan(report: EncounterPublicationPayloadReport): EncounterFactoryDryRunPlanSummary {
  const plan = report.encounterFactoryDryRunPlan;
  const dynamicBehaviorCoverage = report.dynamicEncounterBehaviorCoverage;
  return buildEncounterFactoryDryRunSummary({
    dynamicBehaviorCoverage,
    requestId: plan.sourceRequestId,
    scenarioId: plan.sourceScenarioId,
    actorRoles: plan.actorRoles,
    stageIds: plan.stages.map((stage) => stage.stageId),
    reviewGateIds: uniqueStrings(plan.stages.flatMap((stage) => stage.reviewGateIds)),
    blockerIds: report.blockers,
    blockedPendingRuntimeBundle: plan.status === "blocked_pending_runtime_bundle",
  });
}

function buildCaseDefinedHumanoidRuntimeHandoff(
  workOrders: EncounterGenerationWorkOrder[],
): EncounterPublicationCaseDefinedHumanoidRuntimeHandoff[] {
  const byActorRole = new Map<string, {
    actorRole: string;
    workOrderIds: string[];
    requiredSignalIds: string[];
    requirements: NonNullable<EncounterGenerationWorkOrder["caseDefinedHumanoidPerformanceRequirements"]>;
  }>();
  for (const workOrder of workOrders) {
    if (!workOrder.actorRole || !workOrder.caseDefinedHumanoidPerformanceRequirements) {
      continue;
    }
    const actorRole = workOrder.actorRole;
    const existing = byActorRole.get(actorRole);
    const requiredSignalIds = Array.isArray(workOrder.caseDefinedHumanoidPerformanceRequirements.notEvidenceFor)
      ? workOrder.inputRefs.filter((ref) => ref.startsWith("humanoid-realism-signals://"))
      : [];
    if (existing) {
      existing.workOrderIds.push(workOrder.workOrderId);
      existing.requiredSignalIds.push(...requiredSignalIds);
      continue;
    }
    byActorRole.set(actorRole, {
      actorRole,
      workOrderIds: [workOrder.workOrderId],
      requiredSignalIds,
      requirements: workOrder.caseDefinedHumanoidPerformanceRequirements,
    });
  }
  return Array.from(byActorRole.values()).map((entry) => ({
    claimBoundary: "case_definition_humanoid_runtime_handoff_metadata_only",
    actorRole: entry.actorRole,
    humanoidVariantProfile: buildPublicationHumanoidVariantProfile(entry.actorRole, entry.requirements.locomotionRequired),
    workOrderIds: uniqueStrings(entry.workOrderIds),
    locomotionRequired: entry.requirements.locomotionRequired,
    expressionRequired: entry.requirements.expressionRequired,
    gazeRequired: entry.requirements.gazeRequired,
    lipSyncRequired: entry.requirements.lipSyncRequired,
    interactiveRequired: entry.requirements.interactiveRequired,
    requiredSignalIds: uniqueStrings([
      "animated_humanoid_runtime_playback",
      ...(entry.requirements.expressionRequired ? ["emotion_aligned_expression_transition_cue"] : []),
      ...(entry.requirements.gazeRequired || entry.requirements.lipSyncRequired ? ["dialogue_viseme_and_gaze_mapping"] : []),
      "dialogue_eye_micro_saccade_blink_cue",
      "generated_eyelid_blink_control_cue",
      ...entry.requiredSignalIds,
    ]),
    blockers: [
      "runtime_realism_evidence_not_attached_to_encounter_bundle",
      "visual_qa_evidence_not_attached_to_encounter_bundle",
    ],
    notEvidenceFor: [
      "generated_humanoid_asset_readiness",
      "animation_quality",
      "quest_readiness",
      "runtime_readiness",
      "clinical_validity",
      "scoring_validity",
    ],
  }));
}

function buildPublicationHumanoidVariantProfile(
  actorRole: string,
  locomotionRequired: boolean,
): EncounterPublicationCaseDefinedHumanoidRuntimeHandoff["humanoidVariantProfile"] {
  const clothingLayer = actorRole === "patient"
    ? "patient_gown"
    : ["nurse", "respiratory_therapist", "nurse_observer", "consultant"].includes(actorRole)
      ? "clinical_scrubs"
      : ["family", "spouse", "parent"].includes(actorRole)
        ? "civilian_family"
        : "role_specific";
  return {
    bodyScaleSource: "scenario_actor_role_and_factory_work_order",
    clothingLayer,
    hairFaceRequired: true,
    faceEyeLipRigRequired: true,
    idlePoseRequired: true,
    locomotionRequired,
  };
}

function attachCaseDefinedHumanoidRuntimeHandoff(
  sceneManifest: EncounterRuntimeSceneManifest,
  handoff: EncounterPublicationCaseDefinedHumanoidRuntimeHandoff[],
): EncounterRuntimeSceneManifest & {
  caseDefinedHumanoidRuntimeHandoff?: EncounterPublicationCaseDefinedHumanoidRuntimeHandoff[];
} {
  return handoff.length > 0
    ? { ...sceneManifest, caseDefinedHumanoidRuntimeHandoff: handoff }
    : sceneManifest;
}

function buildCaseDefinitionDrivenFactoryCoverage(input: {
  queueReport: EncounterAssetGenerationQueueReport;
  learnerBundle: LearnerRuntimeAssetBundle | null;
}): EncounterPublicationCaseDefinitionDrivenFactoryCoverage {
  const inputSummary = input.queueReport.request.encounterFactoryInputSummary;
  const requiredActorRoles = uniqueStrings(input.queueReport.request.humanoidRealismRequirements?.requirements
    .map((requirement) => requirement.actorRole) ?? []);
  const learnerBundleActorRoles = uniqueStrings(input.learnerBundle?.actors.map((actor) => actor.role) ?? []);
  const requiredTraceTags = uniqueStrings(inputSummary?.requiredTraceTags ?? inputSummary?.dynamicBehaviorTraceTags ?? []);
  const learnerBundleTraceTags = uniqueStrings(input.learnerBundle?.sceneManifest.dialogueTurns.map((turn) => turn.traceTag) ?? []);
  const readinessManifest = input.queueReport.encounterAssetNeedsReadinessManifest;
  const requiredHumanoidAssetNeedIds = readinessManifest?.requiredHumanoids.map((need) => need.assetNeedId) ?? [];
  const requiredEnvironmentAssetNeedIds = readinessManifest?.requiredEnvironment ? [readinessManifest.requiredEnvironment.assetNeedId] : [];
  const requiredEquipmentAssetNeedIds = readinessManifest?.requiredPropsAndEquipment.map((need) => need.assetNeedId) ?? [];
  const requiredAssetNeedIds = uniqueStrings([
    ...requiredHumanoidAssetNeedIds,
    ...requiredEnvironmentAssetNeedIds,
    ...requiredEquipmentAssetNeedIds,
  ]);
  const workOrderLookupRefs = uniqueStrings(input.queueReport.plan.generationWorkOrders.flatMap((workOrder) => [
    ...workOrder.inputRefs,
    ...workOrder.outputRefs,
    `shared-asset-library-lookup://${workOrder.sharedAssetLibraryReuse.lookupKey}`,
  ]));
  const humanoidWorkOrderRoles = uniqueStrings(input.queueReport.plan.generationWorkOrders
    .filter((workOrder) => workOrder.targetKind === "role_specific_humanoid_glb")
    .map((workOrder) => workOrder.actorRole ?? "")
    .filter((actorRole) => actorRole.length > 0));
  const medicalEquipmentWorkOrderPresent = input.queueReport.plan.generationWorkOrders
    .some((workOrder) => workOrder.targetKind === "medical_equipment_glb");
  const learnerBundleEquipmentIds = uniqueStrings([
    ...Object.keys(input.learnerBundle?.sceneManifest.equipmentPlacements ?? {}),
    ...(input.learnerBundle?.equipment.map((equipment) => equipment.equipmentId) ?? []),
  ]);
  const actorRolesCovered = requiredActorRoles.every((role) => learnerBundleActorRoles.includes(role));
  const traceTagsCovered = requiredTraceTags.every((traceTag) => learnerBundleTraceTags.includes(traceTag));
  const equipmentPlacementsPresent = requiredEquipmentAssetNeedIds.length === 0
    || requiredEquipmentAssetNeedIds.every((assetNeedId) => learnerBundleEquipmentIds.some((equipmentId) => (
      equipmentId === assetNeedId || equipmentId.includes(assetNeedId.replace(/_equipment$/, ""))
    )));
  const assetNeedsCarriedByWorkOrders = requiredActorRoles.every((role) => humanoidWorkOrderRoles.includes(role))
    && (requiredEquipmentAssetNeedIds.length === 0 || medicalEquipmentWorkOrderPresent)
    && (requiredEnvironmentAssetNeedIds.length === 0 || medicalEquipmentWorkOrderPresent);
  const blockers = uniqueStrings([
    ...requiredActorRoles
      .filter((role) => !learnerBundleActorRoles.includes(role))
      .map((role) => `runtime_bundle_missing_actor_role:${role}`),
    ...requiredTraceTags
      .filter((traceTag) => !learnerBundleTraceTags.includes(traceTag))
      .map((traceTag) => `runtime_bundle_missing_trace_tag:${traceTag}`),
    ...requiredEquipmentAssetNeedIds
      .filter((assetNeedId) => !learnerBundleEquipmentIds.some((equipmentId) => (
        equipmentId === assetNeedId || equipmentId.includes(assetNeedId.replace(/_equipment$/, ""))
      )))
      .map((assetNeedId) => `runtime_bundle_missing_equipment:${assetNeedId}`),
    ...(assetNeedsCarriedByWorkOrders ? [] : ["work_orders_missing_case_definition_asset_need_refs"]),
    ...(input.learnerBundle ? [] : ["runtime_bundle_missing_for_case_definition_coverage"]),
  ]);

  return {
    schemaVersion: "openclinxr.case-definition-driven-factory-coverage.v1",
    claimBoundary: "metadata_only_case_definition_to_runtime_bundle_alignment",
    scenarioId: input.queueReport.request.scenarioId,
    source: inputSummary?.source ?? "unknown",
    scenarioStatus: input.queueReport.encounterAssetNeedsReadinessManifest?.scenarioStatus ?? null,
    requiredActorRoles,
    learnerBundleActorRoles,
    requiredTraceTags,
    learnerBundleTraceTags,
    requiredAssetNeedIds,
    workOrderLookupRefs,
    requiredEquipmentAssetNeedIds,
    learnerBundleEquipmentIds,
    coverage: {
      actorRolesCovered,
      traceTagsCovered,
      equipmentPlacementsPresent,
      assetNeedsCarriedByWorkOrders,
    },
    blockers,
    notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
  };
}

export function validateEncounterPublicationPayloadReport(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  requireLiteral(value.schemaVersion, "openclinxr.encounter-publication-payloads.v1", "/schemaVersion", errors);
  requireOneOf(value.status, ["materialized", "blocked"], "/status", errors);
  requireRecord(value.publicationTargets, "/publicationTargets", errors);
  requireRecord(value.localArtifacts, "/localArtifacts", errors);
  requireRecord(value.payloadSummary, "/payloadSummary", errors);
  requireRecord(value.humanoidRealismRequirements, "/humanoidRealismRequirements", errors);
  requireArray(value.humanoidRealismProfiles, "/humanoidRealismProfiles", errors);
  requireArray(value.humanoidRuntimeRequirements, "/humanoidRuntimeRequirements", errors);
  requireArray(value.caseDefinedHumanoidRuntimeHandoff, "/caseDefinedHumanoidRuntimeHandoff", errors);
  validateActorEquipmentMaterializationGate(value.actorEquipmentMaterializationGate, errors);
  requireRecord(value.caseDefinitionDrivenFactoryCoverage, "/caseDefinitionDrivenFactoryCoverage", errors);
  validatePublicationRealismEvidenceRefs(value.realismEvidenceRefs, "/realismEvidenceRefs", errors);
  requireRecord(value.dynamicEncounterBehaviorCoverage, "/dynamicEncounterBehaviorCoverage", errors);
  requireRecord(value.encounterFactoryDryRunPlan, "/encounterFactoryDryRunPlan", errors);
  requireRecord(value.localMaterializationHandoffManifest, "/localMaterializationHandoffManifest", errors);
  requireRecord(value.evidenceBoundaries, "/evidenceBoundaries", errors);
  requireArray(value.blockers, "/blockers", errors);
  if (Object.hasOwn(value, "encounterAssetNeedsReadinessManifest")) {
    validateEncounterAssetNeedsReadinessManifest(value.encounterAssetNeedsReadinessManifest, errors);
  }
  if (Object.hasOwn(value, "remediationWorkOrderRefs")) {
    validateVisualQaRemediationWorkOrderRefs(value.remediationWorkOrderRefs, "/remediationWorkOrderRefs", errors);
  }

  if (isRecord(value.publicationTargets)) {
    requireString(value.publicationTargets.generatedSceneManifestBlobName, "/publicationTargets/generatedSceneManifestBlobName", errors);
    requireString(value.publicationTargets.learnerRuntimeBundleBlobName, "/publicationTargets/learnerRuntimeBundleBlobName", errors);
    requireLiteral(value.publicationTargets.learnerRuntimeBundleMongoCollection, "learner_runtime_asset_bundles", "/publicationTargets/learnerRuntimeBundleMongoCollection", errors);
    requireLiteral(value.publicationTargets.jobStateMongoCollection, "encounter_asset_generation_jobs", "/publicationTargets/jobStateMongoCollection", errors);
  }
  if (isRecord(value.payloadSummary)) {
    requireNumber(value.payloadSummary.roomPropCount, "/payloadSummary/roomPropCount", errors);
    requireNumber(value.payloadSummary.actorCount, "/payloadSummary/actorCount", errors);
    requireNumber(value.payloadSummary.humanoidRequirementActorCount, "/payloadSummary/humanoidRequirementActorCount", errors);
    requireNumber(value.payloadSummary.humanoidRuntimeRequirementActorCount, "/payloadSummary/humanoidRuntimeRequirementActorCount", errors);
    requireNumber(value.payloadSummary.humanoidRealismProfileCount, "/payloadSummary/humanoidRealismProfileCount", errors);
    requireNumber(value.payloadSummary.equipmentCount, "/payloadSummary/equipmentCount", errors);
  }
  if (isRecord(value.humanoidRealismRequirements)) {
    requireLiteral(value.humanoidRealismRequirements.schemaVersion, "openclinxr.encounter-humanoid-realism-requirements.v1", "/humanoidRealismRequirements/schemaVersion", errors);
    requireLiteral(value.humanoidRealismRequirements.source, "scenario_actor_definitions", "/humanoidRealismRequirements/source", errors);
    requireArray(value.humanoidRealismRequirements.requirements, "/humanoidRealismRequirements/requirements", errors);
    requireArray(value.humanoidRealismRequirements.notEvidenceFor, "/humanoidRealismRequirements/notEvidenceFor", errors);
    if (Array.isArray(value.humanoidRealismRequirements.requirements)) {
      if (value.humanoidRealismRequirements.requirements.length === 0) {
        errors.push("/humanoidRealismRequirements/requirements must contain at least one actor role");
      }
      value.humanoidRealismRequirements.requirements.forEach((requirement, index) => {
        if (!isRecord(requirement)) {
          errors.push(`/humanoidRealismRequirements/requirements/${index} must be object`);
          return;
        }
        requireStringArrayIncludes(requirement.requiredAssetKinds, "generated_humanoid_mesh", `/humanoidRealismRequirements/requirements/${index}/requiredAssetKinds`, errors);
        requireStringArrayIncludes(requirement.requiredAssetKinds, "viseme_phoneme_map", `/humanoidRealismRequirements/requirements/${index}/requiredAssetKinds`, errors);
        requireStringArrayIncludes(requirement.requiredAssetKinds, "gaze_blink_control", `/humanoidRealismRequirements/requirements/${index}/requiredAssetKinds`, errors);
        requireStringArrayIncludes(requirement.requiredSignalIds, "dialogue_viseme_and_gaze_mapping", `/humanoidRealismRequirements/requirements/${index}/requiredSignalIds`, errors);
        requireStringArrayIncludes(requirement.requiredSignalIds, "emotion_aligned_expression_transition_cue", `/humanoidRealismRequirements/requirements/${index}/requiredSignalIds`, errors);
      });
    }
    for (const notEvidenceFor of ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"]) {
      requireStringArrayIncludes(value.humanoidRealismRequirements.notEvidenceFor, notEvidenceFor, "/humanoidRealismRequirements/notEvidenceFor", errors);
    }
  }
  if (Array.isArray(value.humanoidRealismProfiles)) {
    const humanoidRequirementActorRoles = isRecord(value.humanoidRealismRequirements)
      && Array.isArray(value.humanoidRealismRequirements.requirements)
      ? new Set(value.humanoidRealismRequirements.requirements
        .filter(isRecord)
        .map((requirement) => String(requirement.actorRole ?? "")))
      : new Set<string>();
    if (
      isRecord(value.payloadSummary)
      && typeof value.payloadSummary.humanoidRealismProfileCount === "number"
      && value.payloadSummary.humanoidRealismProfileCount !== value.humanoidRealismProfiles.length
    ) {
      errors.push("/payloadSummary/humanoidRealismProfileCount must match /humanoidRealismProfiles length");
    }
    value.humanoidRealismProfiles.forEach((profile, index) => {
      if (!isRecord(profile)) {
        errors.push(`/humanoidRealismProfiles/${index} must be object`);
        return;
      }
      requireLiteral(profile.claimScope, "metadata_only_not_visual_quality_evidence", `/humanoidRealismProfiles/${index}/claimScope`, errors);
      if (!humanoidRequirementActorRoles.has(String(profile.actorRole ?? ""))) {
        errors.push(`/humanoidRealismProfiles/${index}/actorRole must match a humanoid realism requirement actorRole`);
      }
      requireStringArrayIncludes(profile.requiredRealismEvidenceIds, "dialogue_viseme_and_gaze_mapping", `/humanoidRealismProfiles/${index}/requiredRealismEvidenceIds`, errors);
      requireStringArrayIncludes(profile.requiredRealismEvidenceIds, "dialogue_eye_micro_saccade_blink_cue", `/humanoidRealismProfiles/${index}/requiredRealismEvidenceIds`, errors);
      requireStringArrayIncludes(profile.requiredRealismEvidenceIds, "generated_eyelid_blink_control_cue", `/humanoidRealismProfiles/${index}/requiredRealismEvidenceIds`, errors);
      requireStringArrayIncludes(profile.requiredRealismEvidenceIds, "emotion_aligned_expression_transition_cue", `/humanoidRealismProfiles/${index}/requiredRealismEvidenceIds`, errors);
    });
  }
  if (Array.isArray(value.humanoidRuntimeRequirements)) {
    if (
      isRecord(value.payloadSummary)
      && typeof value.payloadSummary.humanoidRuntimeRequirementActorCount === "number"
      && value.payloadSummary.humanoidRuntimeRequirementActorCount !== value.humanoidRuntimeRequirements.length
    ) {
      errors.push("/payloadSummary/humanoidRuntimeRequirementActorCount must match /humanoidRuntimeRequirements length");
    }
    value.humanoidRuntimeRequirements.forEach((requirement, index) => {
      if (!isRecord(requirement)) {
        errors.push(`/humanoidRuntimeRequirements/${index} must be object`);
        return;
      }
      requireString(requirement.actorId, `/humanoidRuntimeRequirements/${index}/actorId`, errors);
      requireString(requirement.actorRole, `/humanoidRuntimeRequirements/${index}/actorRole`, errors);
      requireString(requirement.modelAssetId, `/humanoidRuntimeRequirements/${index}/modelAssetId`, errors);
      requireStringArrayIncludes(requirement.requiredAssetKinds, "generated_humanoid_mesh", `/humanoidRuntimeRequirements/${index}/requiredAssetKinds`, errors);
      requireStringArrayIncludes(requirement.requiredAssetKinds, "viseme_phoneme_map", `/humanoidRuntimeRequirements/${index}/requiredAssetKinds`, errors);
      requireStringArrayIncludes(requirement.requiredAssetKinds, "gaze_blink_control", `/humanoidRuntimeRequirements/${index}/requiredAssetKinds`, errors);
      requireStringArrayIncludes(requirement.requiredSignalIds, "dialogue_viseme_and_gaze_mapping", `/humanoidRuntimeRequirements/${index}/requiredSignalIds`, errors);
      requireStringArrayIncludes(requirement.requiredSignalIds, "dialogue_eye_micro_saccade_blink_cue", `/humanoidRuntimeRequirements/${index}/requiredSignalIds`, errors);
      requireStringArrayIncludes(requirement.requiredSignalIds, "generated_eyelid_blink_control_cue", `/humanoidRuntimeRequirements/${index}/requiredSignalIds`, errors);
      requireStringArrayIncludes(requirement.requiredSignalIds, "emotion_aligned_expression_transition_cue", `/humanoidRuntimeRequirements/${index}/requiredSignalIds`, errors);
      requireLiteral(requirement.gazeTargetRequired, true, `/humanoidRuntimeRequirements/${index}/gazeTargetRequired`, errors);
      requireLiteral(requirement.visemeMapRequired, true, `/humanoidRuntimeRequirements/${index}/visemeMapRequired`, errors);
      for (const notEvidenceFor of ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"]) {
        requireStringArrayIncludes(requirement.notEvidenceFor, notEvidenceFor, `/humanoidRuntimeRequirements/${index}/notEvidenceFor`, errors);
      }
    });
  }
  if (Array.isArray(value.caseDefinedHumanoidRuntimeHandoff)) {
    value.caseDefinedHumanoidRuntimeHandoff.forEach((handoff, index) => {
      if (!isRecord(handoff)) {
        errors.push(`/caseDefinedHumanoidRuntimeHandoff/${index} must be object`);
        return;
      }
      requireLiteral(handoff.claimBoundary, "case_definition_humanoid_runtime_handoff_metadata_only", `/caseDefinedHumanoidRuntimeHandoff/${index}/claimBoundary`, errors);
      requireString(handoff.actorRole, `/caseDefinedHumanoidRuntimeHandoff/${index}/actorRole`, errors);
      requireRecord(handoff.humanoidVariantProfile, `/caseDefinedHumanoidRuntimeHandoff/${index}/humanoidVariantProfile`, errors);
      if (isRecord(handoff.humanoidVariantProfile)) {
        requireLiteral(handoff.humanoidVariantProfile.bodyScaleSource, "scenario_actor_role_and_factory_work_order", `/caseDefinedHumanoidRuntimeHandoff/${index}/humanoidVariantProfile/bodyScaleSource`, errors);
        requireLiteral(handoff.humanoidVariantProfile.hairFaceRequired, true, `/caseDefinedHumanoidRuntimeHandoff/${index}/humanoidVariantProfile/hairFaceRequired`, errors);
        requireLiteral(handoff.humanoidVariantProfile.faceEyeLipRigRequired, true, `/caseDefinedHumanoidRuntimeHandoff/${index}/humanoidVariantProfile/faceEyeLipRigRequired`, errors);
        requireLiteral(handoff.humanoidVariantProfile.idlePoseRequired, true, `/caseDefinedHumanoidRuntimeHandoff/${index}/humanoidVariantProfile/idlePoseRequired`, errors);
      }
      requireArray(handoff.workOrderIds, `/caseDefinedHumanoidRuntimeHandoff/${index}/workOrderIds`, errors);
      requireArray(handoff.requiredSignalIds, `/caseDefinedHumanoidRuntimeHandoff/${index}/requiredSignalIds`, errors);
      requireLiteral(handoff.locomotionRequired, true, `/caseDefinedHumanoidRuntimeHandoff/${index}/locomotionRequired`, errors);
      requireLiteral(handoff.interactiveRequired, true, `/caseDefinedHumanoidRuntimeHandoff/${index}/interactiveRequired`, errors);
      requireStringArrayIncludes(handoff.requiredSignalIds, "animated_humanoid_runtime_playback", `/caseDefinedHumanoidRuntimeHandoff/${index}/requiredSignalIds`, errors);
      requireStringArrayIncludes(handoff.requiredSignalIds, "dialogue_eye_micro_saccade_blink_cue", `/caseDefinedHumanoidRuntimeHandoff/${index}/requiredSignalIds`, errors);
      requireStringArrayIncludes(handoff.requiredSignalIds, "generated_eyelid_blink_control_cue", `/caseDefinedHumanoidRuntimeHandoff/${index}/requiredSignalIds`, errors);
      requireStringArrayIncludes(handoff.blockers, "runtime_realism_evidence_not_attached_to_encounter_bundle", `/caseDefinedHumanoidRuntimeHandoff/${index}/blockers`, errors);
      requireStringArrayIncludes(handoff.blockers, "visual_qa_evidence_not_attached_to_encounter_bundle", `/caseDefinedHumanoidRuntimeHandoff/${index}/blockers`, errors);
      for (const notEvidenceFor of ["generated_humanoid_asset_readiness", "animation_quality", "quest_readiness", "runtime_readiness", "clinical_validity", "scoring_validity"]) {
        requireStringArrayIncludes(handoff.notEvidenceFor, notEvidenceFor, `/caseDefinedHumanoidRuntimeHandoff/${index}/notEvidenceFor`, errors);
      }
    });
  }
  if (isRecord(value.actorEquipmentMaterializationGate)) {
    const gate = value.actorEquipmentMaterializationGate;
    if (gate.runtimeSelectionBlockedUntilEvidenceAttached === true && Array.isArray(gate.combinedBlockers) && gate.combinedBlockers.length === 0) {
      errors.push("/actorEquipmentMaterializationGate/combinedBlockers must not be empty when runtime selection is blocked");
    }
  }
  if (isRecord(value.caseDefinitionDrivenFactoryCoverage)) {
    requireLiteral(value.caseDefinitionDrivenFactoryCoverage.schemaVersion, "openclinxr.case-definition-driven-factory-coverage.v1", "/caseDefinitionDrivenFactoryCoverage/schemaVersion", errors);
    requireLiteral(value.caseDefinitionDrivenFactoryCoverage.claimBoundary, "metadata_only_case_definition_to_runtime_bundle_alignment", "/caseDefinitionDrivenFactoryCoverage/claimBoundary", errors);
    requireString(value.caseDefinitionDrivenFactoryCoverage.scenarioId, "/caseDefinitionDrivenFactoryCoverage/scenarioId", errors);
    requireArray(value.caseDefinitionDrivenFactoryCoverage.requiredActorRoles, "/caseDefinitionDrivenFactoryCoverage/requiredActorRoles", errors);
    requireArray(value.caseDefinitionDrivenFactoryCoverage.learnerBundleActorRoles, "/caseDefinitionDrivenFactoryCoverage/learnerBundleActorRoles", errors);
    requireArray(value.caseDefinitionDrivenFactoryCoverage.requiredTraceTags, "/caseDefinitionDrivenFactoryCoverage/requiredTraceTags", errors);
    requireArray(value.caseDefinitionDrivenFactoryCoverage.learnerBundleTraceTags, "/caseDefinitionDrivenFactoryCoverage/learnerBundleTraceTags", errors);
    requireArray(value.caseDefinitionDrivenFactoryCoverage.requiredAssetNeedIds, "/caseDefinitionDrivenFactoryCoverage/requiredAssetNeedIds", errors);
    requireArray(value.caseDefinitionDrivenFactoryCoverage.workOrderLookupRefs, "/caseDefinitionDrivenFactoryCoverage/workOrderLookupRefs", errors);
    requireArray(value.caseDefinitionDrivenFactoryCoverage.requiredEquipmentAssetNeedIds, "/caseDefinitionDrivenFactoryCoverage/requiredEquipmentAssetNeedIds", errors);
    requireArray(value.caseDefinitionDrivenFactoryCoverage.learnerBundleEquipmentIds, "/caseDefinitionDrivenFactoryCoverage/learnerBundleEquipmentIds", errors);
    requireRecord(value.caseDefinitionDrivenFactoryCoverage.coverage, "/caseDefinitionDrivenFactoryCoverage/coverage", errors);
    requireArray(value.caseDefinitionDrivenFactoryCoverage.blockers, "/caseDefinitionDrivenFactoryCoverage/blockers", errors);
    for (const notEvidenceFor of ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"]) {
      requireStringArrayIncludes(value.caseDefinitionDrivenFactoryCoverage.notEvidenceFor, notEvidenceFor, "/caseDefinitionDrivenFactoryCoverage/notEvidenceFor", errors);
    }
  }
  if (isRecord(value.dynamicEncounterBehaviorCoverage)) {
    const requiredActorRoles = isRecord(value.humanoidRealismRequirements)
      && Array.isArray(value.humanoidRealismRequirements.requirements)
      ? value.humanoidRealismRequirements.requirements
        .filter(isRecord)
        .map((requirement) => String(requirement.actorRole ?? ""))
        .filter((actorRole) => actorRole.length > 0)
      : [];
    const blockerIds = Array.isArray(value.dynamicEncounterBehaviorCoverage.blockerIds)
      ? value.dynamicEncounterBehaviorCoverage.blockerIds.filter((blockerId): blockerId is string => typeof blockerId === "string")
      : [];
    const behaviorCoverageBlocked = blockerIds.some((blockerId) => blockerId.startsWith("runtime_bundle_missing_for_behavior_coverage:"));
    requireLiteral(value.dynamicEncounterBehaviorCoverage.schemaVersion, "openclinxr.dynamic-encounter-behavior-coverage.v1", "/dynamicEncounterBehaviorCoverage/schemaVersion", errors);
    requireLiteral(value.dynamicEncounterBehaviorCoverage.claimBoundary, "metadata_only_not_runtime_behavior_evidence", "/dynamicEncounterBehaviorCoverage/claimBoundary", errors);
    requireRecord(value.dynamicEncounterBehaviorCoverage.dialogueTurnCoverage, "/dynamicEncounterBehaviorCoverage/dialogueTurnCoverage", errors);
    requireRecord(value.dynamicEncounterBehaviorCoverage.gazeTargetCoverage, "/dynamicEncounterBehaviorCoverage/gazeTargetCoverage", errors);
    requireRecord(value.dynamicEncounterBehaviorCoverage.actorRolePlacementCoverage, "/dynamicEncounterBehaviorCoverage/actorRolePlacementCoverage", errors);
    requireRecord(value.dynamicEncounterBehaviorCoverage.affectTimelineCoverage, "/dynamicEncounterBehaviorCoverage/affectTimelineCoverage", errors);
    requireArray(value.dynamicEncounterBehaviorCoverage.blockerIds, "/dynamicEncounterBehaviorCoverage/blockerIds", errors);
    requireArray(value.dynamicEncounterBehaviorCoverage.warningIds, "/dynamicEncounterBehaviorCoverage/warningIds", errors);
    if (!behaviorCoverageBlocked && isRecord(value.dynamicEncounterBehaviorCoverage.dialogueTurnCoverage)) {
      validateRoleCoveragePartition({
        path: "/dynamicEncounterBehaviorCoverage/dialogueTurnCoverage",
        covered: value.dynamicEncounterBehaviorCoverage.dialogueTurnCoverage.actorRolesWithDialogueTurns,
        missing: value.dynamicEncounterBehaviorCoverage.dialogueTurnCoverage.missingActorRoles,
        requiredActorRoles,
        missingBlockerPrefix: "dialogue_turn_missing",
        blockerIds,
        errors,
      });
      requireNumber(value.dynamicEncounterBehaviorCoverage.dialogueTurnCoverage.dialogueTurnCount, "/dynamicEncounterBehaviorCoverage/dialogueTurnCoverage/dialogueTurnCount", errors);
    }
    if (!behaviorCoverageBlocked && isRecord(value.dynamicEncounterBehaviorCoverage.gazeTargetCoverage)) {
      validateRoleCoveragePartition({
        path: "/dynamicEncounterBehaviorCoverage/gazeTargetCoverage",
        covered: value.dynamicEncounterBehaviorCoverage.gazeTargetCoverage.actorRolesWithGazeTargets,
        missing: value.dynamicEncounterBehaviorCoverage.gazeTargetCoverage.missingActorRoles,
        requiredActorRoles,
        missingBlockerPrefix: "gaze_target_missing",
        blockerIds,
        errors,
      });
      requireKnownActorRoles(
        value.dynamicEncounterBehaviorCoverage.gazeTargetCoverage.actorRolesWithActorTargetSupport,
        requiredActorRoles,
        "/dynamicEncounterBehaviorCoverage/gazeTargetCoverage/actorRolesWithActorTargetSupport",
        errors,
      );
    }
    if (!behaviorCoverageBlocked && isRecord(value.dynamicEncounterBehaviorCoverage.actorRolePlacementCoverage)) {
      validateRoleCoveragePartition({
        path: "/dynamicEncounterBehaviorCoverage/actorRolePlacementCoverage",
        covered: value.dynamicEncounterBehaviorCoverage.actorRolePlacementCoverage.actorRolesWithPlacements,
        missing: value.dynamicEncounterBehaviorCoverage.actorRolePlacementCoverage.missingActorRoles,
        requiredActorRoles,
        missingBlockerPrefix: "actor_placement_missing",
        blockerIds,
        errors,
      });
    }
    if (!behaviorCoverageBlocked && isRecord(value.dynamicEncounterBehaviorCoverage.affectTimelineCoverage)) {
      validateRoleCoveragePartition({
        path: "/dynamicEncounterBehaviorCoverage/affectTimelineCoverage",
        covered: value.dynamicEncounterBehaviorCoverage.affectTimelineCoverage.actorRolesWithAffectTimelines,
        missing: value.dynamicEncounterBehaviorCoverage.affectTimelineCoverage.missingActorRoles,
        requiredActorRoles,
        missingBlockerPrefix: "affect_timeline_missing",
        blockerIds,
        errors,
      });
      requireNumber(value.dynamicEncounterBehaviorCoverage.affectTimelineCoverage.affectTimelineCount, "/dynamicEncounterBehaviorCoverage/affectTimelineCoverage/affectTimelineCount", errors);
      requireLiteral(value.dynamicEncounterBehaviorCoverage.affectTimelineCoverage.claimBoundary, "metadata_only_not_runtime_facial_animation_evidence", "/dynamicEncounterBehaviorCoverage/affectTimelineCoverage/claimBoundary", errors);
    }
  }
  if (isRecord(value.encounterFactoryDryRunPlan)) {
    const reviewPosture = value.encounterFactoryDryRunPlan.reviewPosture;
    const evidenceBoundaries = value.encounterFactoryDryRunPlan.evidenceBoundaries;
    const dryRunActorRoles = Array.isArray(value.encounterFactoryDryRunPlan.actorRoles)
      ? new Set(value.encounterFactoryDryRunPlan.actorRoles.filter((actorRole): actorRole is string => typeof actorRole === "string"))
      : new Set<string>();
    requireLiteral(value.encounterFactoryDryRunPlan.schemaVersion, "openclinxr.encounter-factory-dry-run-plan.v1", "/encounterFactoryDryRunPlan/schemaVersion", errors);
    requireRecord(reviewPosture, "/encounterFactoryDryRunPlan/reviewPosture", errors);
    if (isRecord(reviewPosture)) {
      requireLiteral(reviewPosture.claimBoundary, "encounter_factory_dry_run_not_asset_generation", "/encounterFactoryDryRunPlan/reviewPosture/claimBoundary", errors);
    }
    requireRecord(evidenceBoundaries, "/encounterFactoryDryRunPlan/evidenceBoundaries", errors);
    if (isRecord(evidenceBoundaries)) {
      requireLiteral(evidenceBoundaries.metadataOnlyPlan, true, "/encounterFactoryDryRunPlan/evidenceBoundaries/metadataOnlyPlan", errors);
      requireLiteral(evidenceBoundaries.generatedAssetsMaterialized, false, "/encounterFactoryDryRunPlan/evidenceBoundaries/generatedAssetsMaterialized", errors);
      requireLiteral(evidenceBoundaries.runtimeBundlePublished, false, "/encounterFactoryDryRunPlan/evidenceBoundaries/runtimeBundlePublished", errors);
      requireLiteral(evidenceBoundaries.learnerRuntimeEnabled, false, "/encounterFactoryDryRunPlan/evidenceBoundaries/learnerRuntimeEnabled", errors);
      requireLiteral(evidenceBoundaries.questReadinessClaimed, false, "/encounterFactoryDryRunPlan/evidenceBoundaries/questReadinessClaimed", errors);
      requireLiteral(evidenceBoundaries.productionReadinessClaimed, false, "/encounterFactoryDryRunPlan/evidenceBoundaries/productionReadinessClaimed", errors);
    }
    requireArray(value.encounterFactoryDryRunPlan.actorRoles, "/encounterFactoryDryRunPlan/actorRoles", errors);
    requireArray(value.encounterFactoryDryRunPlan.generationWorkOrders, "/encounterFactoryDryRunPlan/generationWorkOrders", errors);
    requireArray(value.encounterFactoryDryRunPlan.stages, "/encounterFactoryDryRunPlan/stages", errors);
    if (Array.isArray(value.encounterFactoryDryRunPlan.generationWorkOrders)) {
      const targetKinds = new Set(value.encounterFactoryDryRunPlan.generationWorkOrders.filter(isRecord).map((workOrder) => String(workOrder.targetKind ?? "")));
      for (const requiredTargetKind of [
        "role_specific_humanoid_glb",
        "medical_equipment_glb",
        "role_idle_animation_glb",
        "visual_feedback_closure",
      ]) {
        if (!targetKinds.has(requiredTargetKind)) {
          errors.push(`/encounterFactoryDryRunPlan/generationWorkOrders must include ${requiredTargetKind}`);
        }
      }
      value.encounterFactoryDryRunPlan.generationWorkOrders.forEach((workOrder, index) => {
        if (!isRecord(workOrder)) {
          errors.push(`/encounterFactoryDryRunPlan/generationWorkOrders/${index} must be object`);
          return;
        }
        requireString(workOrder.workOrderId, `/encounterFactoryDryRunPlan/generationWorkOrders/${index}/workOrderId`, errors);
        requireString(workOrder.targetKind, `/encounterFactoryDryRunPlan/generationWorkOrders/${index}/targetKind`, errors);
        requireString(workOrder.capabilityId, `/encounterFactoryDryRunPlan/generationWorkOrders/${index}/capabilityId`, errors);
        requireArray(workOrder.providerRoutingPreference, `/encounterFactoryDryRunPlan/generationWorkOrders/${index}/providerRoutingPreference`, errors);
        if (Array.isArray(workOrder.providerRoutingPreference) && workOrder.providerRoutingPreference.length === 0) {
          errors.push(`/encounterFactoryDryRunPlan/generationWorkOrders/${index}/providerRoutingPreference must contain at least one provider route`);
        }
        requireRecord(workOrder.modelProviderPolicy, `/encounterFactoryDryRunPlan/generationWorkOrders/${index}/modelProviderPolicy`, errors);
        if (isRecord(workOrder.modelProviderPolicy)) {
          requireLiteral(workOrder.modelProviderPolicy.executionStatus, "metadata_only_not_executed", `/encounterFactoryDryRunPlan/generationWorkOrders/${index}/modelProviderPolicy/executionStatus`, errors);
          requireLiteral(workOrder.modelProviderPolicy.allowPaidCloudApis, false, `/encounterFactoryDryRunPlan/generationWorkOrders/${index}/modelProviderPolicy/allowPaidCloudApis`, errors);
          requireLiteral(workOrder.modelProviderPolicy.allowExternalNetwork, false, `/encounterFactoryDryRunPlan/generationWorkOrders/${index}/modelProviderPolicy/allowExternalNetwork`, errors);
          requireLiteral(workOrder.modelProviderPolicy.providerRoutesRequireExplicitApproval, true, `/encounterFactoryDryRunPlan/generationWorkOrders/${index}/modelProviderPolicy/providerRoutesRequireExplicitApproval`, errors);
        }
        requireRecord(workOrder.sharedAssetLibraryReuse, `/encounterFactoryDryRunPlan/generationWorkOrders/${index}/sharedAssetLibraryReuse`, errors);
        if (isRecord(workOrder.sharedAssetLibraryReuse)) {
          requireString(workOrder.sharedAssetLibraryReuse.lookupKey, `/encounterFactoryDryRunPlan/generationWorkOrders/${index}/sharedAssetLibraryReuse/lookupKey`, errors);
          requireLiteral(workOrder.sharedAssetLibraryReuse.lookupKeySource, "encounter_definition_semantic_requirements", `/encounterFactoryDryRunPlan/generationWorkOrders/${index}/sharedAssetLibraryReuse/lookupKeySource`, errors);
          requireLiteral(workOrder.sharedAssetLibraryReuse.cacheDisposition, "lookup_before_generate", `/encounterFactoryDryRunPlan/generationWorkOrders/${index}/sharedAssetLibraryReuse/cacheDisposition`, errors);
          requireRecord(workOrder.sharedAssetLibraryReuse.sharedLibraryRefs, `/encounterFactoryDryRunPlan/generationWorkOrders/${index}/sharedAssetLibraryReuse/sharedLibraryRefs`, errors);
          requireRecord(workOrder.sharedAssetLibraryReuse.lruCache, `/encounterFactoryDryRunPlan/generationWorkOrders/${index}/sharedAssetLibraryReuse/lruCache`, errors);
          if (isRecord(workOrder.sharedAssetLibraryReuse.sharedLibraryRefs)) {
            requireString(workOrder.sharedAssetLibraryReuse.sharedLibraryRefs.blobPrefix, `/encounterFactoryDryRunPlan/generationWorkOrders/${index}/sharedAssetLibraryReuse/sharedLibraryRefs/blobPrefix`, errors);
            requireLiteral(workOrder.sharedAssetLibraryReuse.sharedLibraryRefs.mongooseCollectionName, "shared_encounter_asset_library", `/encounterFactoryDryRunPlan/generationWorkOrders/${index}/sharedAssetLibraryReuse/sharedLibraryRefs/mongooseCollectionName`, errors);
          }
          if (isRecord(workOrder.sharedAssetLibraryReuse.lruCache)) {
            requireLiteral(workOrder.sharedAssetLibraryReuse.lruCache.enabled, true, `/encounterFactoryDryRunPlan/generationWorkOrders/${index}/sharedAssetLibraryReuse/lruCache/enabled`, errors);
            requireLiteral(workOrder.sharedAssetLibraryReuse.lruCache.evictionPolicy, "least_recently_used", `/encounterFactoryDryRunPlan/generationWorkOrders/${index}/sharedAssetLibraryReuse/lruCache/evictionPolicy`, errors);
            requireLiteral(workOrder.sharedAssetLibraryReuse.lruCache.reuseRequiresEvidenceGateCompatibility, true, `/encounterFactoryDryRunPlan/generationWorkOrders/${index}/sharedAssetLibraryReuse/lruCache/reuseRequiresEvidenceGateCompatibility`, errors);
            requireLiteral(workOrder.sharedAssetLibraryReuse.lruCache.updateRecencyOnHit, true, `/encounterFactoryDryRunPlan/generationWorkOrders/${index}/sharedAssetLibraryReuse/lruCache/updateRecencyOnHit`, errors);
          }
        }
        requireArray(workOrder.visualQaBlockerRefs, `/encounterFactoryDryRunPlan/generationWorkOrders/${index}/visualQaBlockerRefs`, errors);
        requireArray(workOrder.acceptanceCriteria, `/encounterFactoryDryRunPlan/generationWorkOrders/${index}/acceptanceCriteria`, errors);
      });
    }
    if (Array.isArray(value.humanoidRealismProfiles)) {
      value.humanoidRealismProfiles
        .filter(isRecord)
        .forEach((profile, index) => {
          if (!dryRunActorRoles.has(String(profile.actorRole ?? ""))) {
            errors.push(`/encounterFactoryDryRunPlan/actorRoles must include /humanoidRealismProfiles/${index}/actorRole`);
          }
        });
    }
    if (
      Array.isArray(value.encounterFactoryDryRunPlan.stages)
      && typeof value.encounterFactoryDryRunPlan.stageCount === "number"
      && value.encounterFactoryDryRunPlan.stageCount !== value.encounterFactoryDryRunPlan.stages.length
    ) {
      errors.push("/encounterFactoryDryRunPlan/stageCount must match /encounterFactoryDryRunPlan/stages length");
    }
    if (Array.isArray(value.encounterFactoryDryRunPlan.stages)) {
      const stageIds = new Set<string>();
      value.encounterFactoryDryRunPlan.stages.forEach((stage, index) => {
        if (!isRecord(stage)) {
          errors.push(`/encounterFactoryDryRunPlan/stages/${index} must be object`);
          return;
        }
        if (typeof stage.stageId === "string") stageIds.add(stage.stageId);
        requireArray(stage.inputRefs, `/encounterFactoryDryRunPlan/stages/${index}/inputRefs`, errors);
        requireArray(stage.outputRefs, `/encounterFactoryDryRunPlan/stages/${index}/outputRefs`, errors);
        requireArray(stage.reviewGateIds, `/encounterFactoryDryRunPlan/stages/${index}/reviewGateIds`, errors);
      });
      for (const requiredStageId of [
        "scenario_definition_to_asset_requirements",
        "generation_work_order_routing_plan",
        "humanoid_roles_to_realism_profiles",
        "runtime_bundle_binding_plan",
        "publication_and_evidence_gate_plan",
      ]) {
        if (!stageIds.has(requiredStageId)) {
          errors.push(`/encounterFactoryDryRunPlan/stages must include ${requiredStageId}`);
        }
      }
    }
  }
  if (isRecord(value.localMaterializationHandoffManifest)) {
    requireLiteral(value.localMaterializationHandoffManifest.schemaVersion, "openclinxr.worker-materialization-plan.v1", "/localMaterializationHandoffManifest/schemaVersion", errors);
    requireLiteral(value.localMaterializationHandoffManifest.claimBoundary, "planned_metadata_only", "/localMaterializationHandoffManifest/claimBoundary", errors);
    requireLiteral(value.localMaterializationHandoffManifest.generatedAssetsMaterialized, false, "/localMaterializationHandoffManifest/generatedAssetsMaterialized", errors);
    requireLiteral(value.localMaterializationHandoffManifest.paidApisUsed, false, "/localMaterializationHandoffManifest/paidApisUsed", errors);
    requireLiteral(value.localMaterializationHandoffManifest.productionReadinessClaimed, false, "/localMaterializationHandoffManifest/productionReadinessClaimed", errors);
    if (typeof value.localMaterializationHandoffManifest.rootPath !== "string" || !value.localMaterializationHandoffManifest.rootPath.startsWith(".openclinxr/encounter-factory/")) {
      errors.push("/localMaterializationHandoffManifest/rootPath must be an encounter-factory local path");
    }
    requireArray(value.localMaterializationHandoffManifest.outputs, "/localMaterializationHandoffManifest/outputs", errors);
  }
  if (isRecord(value.evidenceBoundaries)) {
    requireLiteral(value.evidenceBoundaries.dynamicEncounterPayload, true, "/evidenceBoundaries/dynamicEncounterPayload", errors);
    requireLiteral(value.evidenceBoundaries.runtimeHardcodingRequired, false, "/evidenceBoundaries/runtimeHardcodingRequired", errors);
    requireLiteral(value.evidenceBoundaries.azureCloudOperationPerformed, false, "/evidenceBoundaries/azureCloudOperationPerformed", errors);
    requireLiteral(value.evidenceBoundaries.mongoWritePerformed, false, "/evidenceBoundaries/mongoWritePerformed", errors);
    requireLiteral(value.evidenceBoundaries.paidApisUsed, false, "/evidenceBoundaries/paidApisUsed", errors);
    requireLiteral(value.evidenceBoundaries.productionReadinessClaimed, false, "/evidenceBoundaries/productionReadinessClaimed", errors);
    requireLiteral(value.evidenceBoundaries.questReadinessClaimed, false, "/evidenceBoundaries/questReadinessClaimed", errors);
    requireLiteral(value.evidenceBoundaries.clinicalValidityClaimed, false, "/evidenceBoundaries/clinicalValidityClaimed", errors);
    requireLiteral(value.evidenceBoundaries.scoringValidityClaimed, false, "/evidenceBoundaries/scoringValidityClaimed", errors);
  }
  if (value.status === "materialized" && Array.isArray(value.blockers) && value.blockers.length > 0) {
    errors.push("/blockers must be empty when materialized");
  }
  if (
    value.status === "materialized"
    && Array.isArray(value.humanoidRuntimeRequirements)
    && value.humanoidRuntimeRequirements.length > 0
  ) {
    const refIds = isRecord(value.realismEvidenceRefs) && Array.isArray(value.realismEvidenceRefs.refs)
      ? new Set(value.realismEvidenceRefs.refs.filter(isRecord).map((ref) => String(ref.refId ?? "")))
      : new Set<string>();
    for (const requiredRefId of ["humanoid-realism-gate", "runtime-realism-evidence-check", "visual-qa-evidence-check"]) {
      if (!refIds.has(requiredRefId)) {
        errors.push(`/realismEvidenceRefs/refs must include ${requiredRefId} when materialized humanoid runtime requirements exist`);
      }
    }
  }
  if (Object.hasOwn(value, "projectionArtifactConsumption")) {
    if (isRecord(value.projectionArtifactConsumption)) {
      requireLiteral(
        value.projectionArtifactConsumption.source,
        "scenario_bank_dynamic_encounter_factory_projection_artifact",
        "/projectionArtifactConsumption/source",
        errors,
      );
      requireLiteral(
        value.projectionArtifactConsumption.sourceSchemaVersion,
        "openclinxr.dynamic-encounter-factory-projection-artifact.v1",
        "/projectionArtifactConsumption/sourceSchemaVersion",
        errors,
      );
      requireString(value.projectionArtifactConsumption.anchorScenarioId, "/projectionArtifactConsumption/anchorScenarioId", errors);
      if (
        value.projectionArtifactConsumption.nextFactoryPlanningScenarioId !== null
        && typeof value.projectionArtifactConsumption.nextFactoryPlanningScenarioId !== "string"
      ) {
        errors.push("/projectionArtifactConsumption/nextFactoryPlanningScenarioId must be string or null");
      }
      if (
        value.projectionArtifactConsumption.nextFactoryPlanningScenarioSelectionMode !== "approved_encounter_variant"
        && value.projectionArtifactConsumption.nextFactoryPlanningScenarioSelectionMode !== "next_scenario_fallback"
        && value.projectionArtifactConsumption.nextFactoryPlanningScenarioSelectionMode !== "anchor_not_found"
      ) {
        errors.push(
          "/projectionArtifactConsumption/nextFactoryPlanningScenarioSelectionMode must be approved_encounter_variant, next_scenario_fallback, or anchor_not_found",
        );
      }
      requireNumber(
        value.projectionArtifactConsumption.scenarioBankSliceSize,
        "/projectionArtifactConsumption/scenarioBankSliceSize",
        errors,
      );
      requireRecord(
        value.projectionArtifactConsumption.sharedAssetReuseSummary,
        "/projectionArtifactConsumption/sharedAssetReuseSummary",
        errors,
      );
      if (isRecord(value.projectionArtifactConsumption.sharedAssetReuseSummary)) {
        requireArray(
          value.projectionArtifactConsumption.sharedAssetReuseSummary.scenarioBankSliceScenarioIds,
          "/projectionArtifactConsumption/sharedAssetReuseSummary/scenarioBankSliceScenarioIds",
          errors,
        );
        requireNumber(
          value.projectionArtifactConsumption.sharedAssetReuseSummary.scenarioBankSliceSize,
          "/projectionArtifactConsumption/sharedAssetReuseSummary/scenarioBankSliceSize",
          errors,
        );
        requireNumber(
          value.projectionArtifactConsumption.sharedAssetReuseSummary.workOrderCount,
          "/projectionArtifactConsumption/sharedAssetReuseSummary/workOrderCount",
          errors,
        );
        requireArray(
          value.projectionArtifactConsumption.sharedAssetReuseSummary.distinctLookupKeys,
          "/projectionArtifactConsumption/sharedAssetReuseSummary/distinctLookupKeys",
          errors,
        );
        requireArray(
          value.projectionArtifactConsumption.sharedAssetReuseSummary.distinctSharedLibraryBlobPrefixes,
          "/projectionArtifactConsumption/sharedAssetReuseSummary/distinctSharedLibraryBlobPrefixes",
          errors,
        );
        requireLiteral(
          value.projectionArtifactConsumption.sharedAssetReuseSummary.sharedLibraryMongooseCollectionName,
          "shared_encounter_asset_library",
          "/projectionArtifactConsumption/sharedAssetReuseSummary/sharedLibraryMongooseCollectionName",
          errors,
        );
        if (
          Array.isArray(value.projectionArtifactConsumption.sharedAssetReuseSummary.scenarioBankSliceScenarioIds)
          && typeof value.projectionArtifactConsumption.sharedAssetReuseSummary.scenarioBankSliceSize === "number"
          && value.projectionArtifactConsumption.sharedAssetReuseSummary.scenarioBankSliceScenarioIds.length
            !== value.projectionArtifactConsumption.sharedAssetReuseSummary.scenarioBankSliceSize
        ) {
          errors.push("/projectionArtifactConsumption/sharedAssetReuseSummary/scenarioBankSliceSize must match /projectionArtifactConsumption/sharedAssetReuseSummary/scenarioBankSliceScenarioIds length");
        }
        if (
          isRecord(value.encounterFactoryDryRunPlan)
          && Array.isArray(value.encounterFactoryDryRunPlan.generationWorkOrders)
          && typeof value.projectionArtifactConsumption.sharedAssetReuseSummary.workOrderCount === "number"
          && value.projectionArtifactConsumption.sharedAssetReuseSummary.workOrderCount !== value.encounterFactoryDryRunPlan.generationWorkOrders.length
        ) {
          errors.push("/projectionArtifactConsumption/sharedAssetReuseSummary/workOrderCount must match /encounterFactoryDryRunPlan/generationWorkOrders length");
        }
      }
    } else {
      errors.push("/projectionArtifactConsumption must be object");
    }
  }

  validateEncounterOperationalBoundaryNotes(value.operationalNotes, "/operationalNotes", errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateEncounterAssetNeedsReadinessManifest(
  value: unknown,
  errors: string[],
): void {
  if (!isRecord(value)) {
    errors.push("/encounterAssetNeedsReadinessManifest must be object");
    return;
  }
  requireLiteral(value.schemaVersion, "openclinxr.encounter-asset-needs-readiness.v1", "/encounterAssetNeedsReadinessManifest/schemaVersion", errors);
  requireString(value.scenarioId, "/encounterAssetNeedsReadinessManifest/scenarioId", errors);
  requireString(value.scenarioTitle, "/encounterAssetNeedsReadinessManifest/scenarioTitle", errors);
  requireString(value.scenarioStatus, "/encounterAssetNeedsReadinessManifest/scenarioStatus", errors);
  requireString(value.generatedAt, "/encounterAssetNeedsReadinessManifest/generatedAt", errors);
  requireArray(value.requiredHumanoids, "/encounterAssetNeedsReadinessManifest/requiredHumanoids", errors);
  if (value.requiredEnvironment !== null && !isRecord(value.requiredEnvironment)) {
    errors.push("/encounterAssetNeedsReadinessManifest/requiredEnvironment must be object or null");
  }
  requireArray(value.requiredPropsAndEquipment, "/encounterAssetNeedsReadinessManifest/requiredPropsAndEquipment", errors);
  if (!isRecord(value.animationRequirements)) {
    errors.push("/encounterAssetNeedsReadinessManifest/animationRequirements must be object");
  }
  if (!isRecord(value.emotionRequirements)) {
    errors.push("/encounterAssetNeedsReadinessManifest/emotionRequirements must be object");
  }
  if (!isRecord(value.gazeRequirements)) {
    errors.push("/encounterAssetNeedsReadinessManifest/gazeRequirements must be object");
  }
  if (!isRecord(value.lipSyncRequirements)) {
    errors.push("/encounterAssetNeedsReadinessManifest/lipSyncRequirements must be object");
  }
  requireArray(value.sharedAssetLibrarySemanticKeys, "/encounterAssetNeedsReadinessManifest/sharedAssetLibrarySemanticKeys", errors);
  requireArray(value.missingRequiredAssetNeedIds, "/encounterAssetNeedsReadinessManifest/missingRequiredAssetNeedIds", errors);
  requireArray(value.blockers, "/encounterAssetNeedsReadinessManifest/blockers", errors);
  requireArray(value.warnings, "/encounterAssetNeedsReadinessManifest/warnings", errors);
  if (typeof value.readyForDeterministicGeneration !== "boolean") {
    errors.push("/encounterAssetNeedsReadinessManifest/readyForDeterministicGeneration must be boolean");
  }
}

function collectEncounterAssetNeedsReadinessBlockers(
  encounterAssetNeedsReadinessManifest?: EncounterAssetGenerationQueueReport["encounterAssetNeedsReadinessManifest"],
): string[] {
  if (!encounterAssetNeedsReadinessManifest || !Array.isArray(encounterAssetNeedsReadinessManifest.blockers)) {
    return [];
  }
  return encounterAssetNeedsReadinessManifest.blockers
    .filter((blocker): blocker is string => typeof blocker === "string");
}

function validateActorEquipmentMaterializationGate(value: unknown, errors: string[]): void {
  requireRecord(value, "/actorEquipmentMaterializationGate", errors);
  if (!isRecord(value)) return;
  requireLiteral(value.schemaVersion, "openclinxr.actor-equipment-materialization-gate.v1", "/actorEquipmentMaterializationGate/schemaVersion", errors);
  requireLiteral(value.claimBoundary, "materialization_contract_metadata_only_not_runtime_readiness", "/actorEquipmentMaterializationGate/claimBoundary", errors);
  requireLiteral(value.source, "generated_station_runtime_bundle_materialization_contracts", "/actorEquipmentMaterializationGate/source", errors);
  if (typeof value.runtimeSelectionBlockedUntilEvidenceAttached !== "boolean") {
    errors.push("/actorEquipmentMaterializationGate/runtimeSelectionBlockedUntilEvidenceAttached must be boolean");
  }
  requireRecord(value.actorGate, "/actorEquipmentMaterializationGate/actorGate", errors);
  if (isRecord(value.actorGate)) {
    requireLiteral(value.actorGate.actorSpecificVariantKeysRequired, true, "/actorEquipmentMaterializationGate/actorGate/actorSpecificVariantKeysRequired", errors);
    requireArray(value.actorGate.actorRoles, "/actorEquipmentMaterializationGate/actorGate/actorRoles", errors);
    requireArray(value.actorGate.materializationBlockers, "/actorEquipmentMaterializationGate/actorGate/materializationBlockers", errors);
    requireArray(value.actorGate.caveats, "/actorEquipmentMaterializationGate/actorGate/caveats", errors);
    requireString(value.actorGate.recommendedNextAction, "/actorEquipmentMaterializationGate/actorGate/recommendedNextAction", errors);
  }
  requireRecord(value.equipmentGate, "/actorEquipmentMaterializationGate/equipmentGate", errors);
  if (isRecord(value.equipmentGate)) {
    requireLiteral(value.equipmentGate.equipmentSpecificVariantKeysRequired, true, "/actorEquipmentMaterializationGate/equipmentGate/equipmentSpecificVariantKeysRequired", errors);
    requireArray(value.equipmentGate.equipmentIds, "/actorEquipmentMaterializationGate/equipmentGate/equipmentIds", errors);
    requireArray(value.equipmentGate.materializationBlockers, "/actorEquipmentMaterializationGate/equipmentGate/materializationBlockers", errors);
    requireArray(value.equipmentGate.caveats, "/actorEquipmentMaterializationGate/equipmentGate/caveats", errors);
    requireString(value.equipmentGate.recommendedNextAction, "/actorEquipmentMaterializationGate/equipmentGate/recommendedNextAction", errors);
  }
  requireArray(value.combinedBlockers, "/actorEquipmentMaterializationGate/combinedBlockers", errors);
  requireArray(value.combinedCaveats, "/actorEquipmentMaterializationGate/combinedCaveats", errors);
  requireArray(value.notEvidenceFor, "/actorEquipmentMaterializationGate/notEvidenceFor", errors);
  if (value.materializationEvidenceAttachment !== undefined) {
    requireRecord(value.materializationEvidenceAttachment, "/actorEquipmentMaterializationGate/materializationEvidenceAttachment", errors);
    if (isRecord(value.materializationEvidenceAttachment)) {
      requireLiteral(value.materializationEvidenceAttachment.source, "encounter_materialization_evidence_report", "/actorEquipmentMaterializationGate/materializationEvidenceAttachment/source", errors);
      if (typeof value.materializationEvidenceAttachment.attachableToRuntimeSelection !== "boolean") {
        errors.push("/actorEquipmentMaterializationGate/materializationEvidenceAttachment/attachableToRuntimeSelection must be boolean");
      }
      requireArray(value.materializationEvidenceAttachment.actorRequiredEvidenceRefs, "/actorEquipmentMaterializationGate/materializationEvidenceAttachment/actorRequiredEvidenceRefs", errors);
      requireArray(value.materializationEvidenceAttachment.equipmentRequiredEvidenceRefs, "/actorEquipmentMaterializationGate/materializationEvidenceAttachment/equipmentRequiredEvidenceRefs", errors);
      requireArray(value.materializationEvidenceAttachment.blockers, "/actorEquipmentMaterializationGate/materializationEvidenceAttachment/blockers", errors);
      requireLiteral(value.materializationEvidenceAttachment.claimBoundary, "materialization_evidence_attachment_contract_not_runtime_readiness", "/actorEquipmentMaterializationGate/materializationEvidenceAttachment/claimBoundary", errors);
    }
  }
  if (value.materializationEvidenceAttachmentSummary !== undefined) {
    requireRecord(value.materializationEvidenceAttachmentSummary, "/actorEquipmentMaterializationGate/materializationEvidenceAttachmentSummary", errors);
    if (isRecord(value.materializationEvidenceAttachmentSummary)) {
      requireLiteral(value.materializationEvidenceAttachmentSummary.source, "encounter_materialization_evidence_attachments", "/actorEquipmentMaterializationGate/materializationEvidenceAttachmentSummary/source", errors);
      requireNumber(value.materializationEvidenceAttachmentSummary.totalRequiredSlotCount, "/actorEquipmentMaterializationGate/materializationEvidenceAttachmentSummary/totalRequiredSlotCount", errors);
      requireNumber(value.materializationEvidenceAttachmentSummary.attachedSlotCount, "/actorEquipmentMaterializationGate/materializationEvidenceAttachmentSummary/attachedSlotCount", errors);
      requireNumber(value.materializationEvidenceAttachmentSummary.missingSlotCount, "/actorEquipmentMaterializationGate/materializationEvidenceAttachmentSummary/missingSlotCount", errors);
      requireLiteral(value.materializationEvidenceAttachmentSummary.runtimeSelectionAllowed, false, "/actorEquipmentMaterializationGate/materializationEvidenceAttachmentSummary/runtimeSelectionAllowed", errors);
      requireLiteral(value.materializationEvidenceAttachmentSummary.learnerLaunchAllowed, false, "/actorEquipmentMaterializationGate/materializationEvidenceAttachmentSummary/learnerLaunchAllowed", errors);
      requireLiteral(value.materializationEvidenceAttachmentSummary.questEvidenceRefreshAllowed, false, "/actorEquipmentMaterializationGate/materializationEvidenceAttachmentSummary/questEvidenceRefreshAllowed", errors);
      requireLiteral(value.materializationEvidenceAttachmentSummary.claimBoundary, "metadata_only_materialization_evidence_attachment_summary", "/actorEquipmentMaterializationGate/materializationEvidenceAttachmentSummary/claimBoundary", errors);
    }
  }
}

function buildActorEquipmentMaterializationGate(
  bundleReport?: GeneratedEdStationRuntimeBundleReport,
  materializationEvidenceReport?: EncounterMaterializationEvidenceReport,
  materializationEvidenceAttachments?: EncounterMaterializationEvidenceAttachmentRecords,
): EncounterPublicationActorEquipmentMaterializationGate {
  const actorContract = bundleReport?.actorHumanoidMaterializationContract;
  const equipmentContract = bundleReport?.equipmentMaterializationContract;
  const actorBlockers = actorContract?.materializationBlockers ?? ["actor_humanoid_materialization_contract_not_attached"];
  const equipmentBlockers = equipmentContract?.materializationBlockers ?? ["equipment_materialization_contract_not_attached"];
  const actorCaveats = actorContract?.caveats ?? ["Actor-specific humanoid variant evidence is not attached to the generated station runtime bundle."];
  const equipmentCaveats = equipmentContract?.caveats ?? ["Equipment-specific materialization evidence is not attached to the generated station runtime bundle."];
  const materializationEvidenceBlockers = materializationEvidenceReport?.attachableToRuntimeSelection === false
    ? materializationEvidenceReport.blockers
    : [];
  const combinedBlockers = uniqueStrings([...actorBlockers, ...equipmentBlockers, ...materializationEvidenceBlockers]);
  const combinedCaveats = uniqueStrings([...actorCaveats, ...equipmentCaveats]);
  const gate: EncounterPublicationActorEquipmentMaterializationGate = {
    schemaVersion: "openclinxr.actor-equipment-materialization-gate.v1",
    claimBoundary: "materialization_contract_metadata_only_not_runtime_readiness",
    source: "generated_station_runtime_bundle_materialization_contracts",
    runtimeSelectionBlockedUntilEvidenceAttached: combinedBlockers.length > 0,
    actorGate: {
      actorSpecificVariantKeysRequired: actorContract?.actorSpecificVariantKeysRequired ?? true,
      sharedNeutralMeshReuseDetected: actorContract?.sharedNeutralMeshReuseDetected ?? true,
      actorVariantCount: actorContract?.actorVariants.length ?? 0,
      actorRoles: uniqueStrings(actorContract?.actorVariants.map((variant) => variant.actorRole) ?? []),
      materializationBlockers: [...actorBlockers],
      caveats: [...actorCaveats],
      recommendedNextAction: actorContract?.recommendedNextAction ?? "attach actor-specific humanoid materialization contract evidence before guarded runtime selection",
    },
    equipmentGate: {
      equipmentSpecificVariantKeysRequired: equipmentContract?.equipmentSpecificVariantKeysRequired ?? true,
      genericEquipmentReuseDetected: equipmentContract?.genericEquipmentReuseDetected ?? true,
      equipmentVariantCount: equipmentContract?.equipmentVariants.length ?? 0,
      equipmentIds: uniqueStrings(equipmentContract?.equipmentVariants.map((variant) => variant.equipmentId) ?? []),
      materializationBlockers: [...equipmentBlockers],
      caveats: [...equipmentCaveats],
      recommendedNextAction: equipmentContract?.recommendedNextAction ?? "attach equipment-specific materialization contract evidence before guarded runtime selection",
    },
    combinedBlockers,
    combinedCaveats,
    notEvidenceFor: ["runtime_readiness", "quest_readiness", "production_asset_readiness", "clinical_validity", "scoring_validity"],
    remainingRuntimeBlockerReasons: buildRemainingRuntimeBlockerReasons(materializationEvidenceAttachments),
  };
  if (materializationEvidenceReport) {
    gate.materializationEvidenceAttachment = {
      source: "encounter_materialization_evidence_report",
      reportStatus: materializationEvidenceReport.status,
      attachableToRuntimeSelection: materializationEvidenceReport.attachableToRuntimeSelection,
      actorRequiredEvidenceRefs: uniqueStrings(materializationEvidenceReport.actorEvidence.flatMap((entry) => entry.requiredEvidenceRefs)),
      equipmentRequiredEvidenceRefs: uniqueStrings(materializationEvidenceReport.equipmentEvidence.flatMap((entry) => entry.requiredEvidenceRefs)),
      blockers: [...materializationEvidenceReport.blockers],
      claimBoundary: materializationEvidenceReport.claimBoundary,
    };
  }
  if (materializationEvidenceAttachments) {
    gate.materializationEvidenceAttachmentSummary = {
      source: "encounter_materialization_evidence_attachments",
      totalRequiredSlotCount: materializationEvidenceAttachments.attachmentCompleteness.totalRequiredSlotCount,
      attachedSlotCount: materializationEvidenceAttachments.attachmentCompleteness.attachedSlotCount,
      missingSlotCount: materializationEvidenceAttachments.attachmentCompleteness.missingSlotCount,
      heldOrInvalidAttachmentCount: materializationEvidenceAttachments.attachmentCompleteness.heldOrInvalidAttachmentCount,
      allRequiredSlotsSatisfied: materializationEvidenceAttachments.attachmentCompleteness.allRequiredSlotsSatisfied,
      blockers: [...materializationEvidenceAttachments.blockers],
      runtimeSelectionAllowed: false,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
      claimBoundary: "metadata_only_materialization_evidence_attachment_summary",
    };
  }
  return gate;
}

function buildRemainingRuntimeBlockerReasons(
  materializationEvidenceAttachments?: EncounterMaterializationEvidenceAttachmentRecords,
): EncounterPublicationActorEquipmentMaterializationGate["remainingRuntimeBlockerReasons"] {
  const materializationEvidenceComplete = materializationEvidenceAttachments?.attachmentCompleteness.allRequiredSlotsSatisfied === true;
  return {
    source: "materialization_attachment_summary_and_publication_runtime_gates",
    materializationEvidenceComplete,
    runtimeSelectionAllowed: false,
    learnerLaunchAllowed: false,
    questEvidenceRefreshAllowed: false,
    categories: [
      {
        category: "runtime_selector",
        blockerIds: ["runtime_selector_disabled_guard_not_wired"],
        recommendedNextAction: "review guarded runtime selector wiring only after runtime, visual QA, and Quest evidence refs attach",
      },
      {
        category: "runtime_realism",
        blockerIds: ["runtime_realism_evidence_not_attached"],
        recommendedNextAction: "attach case-derived runtime realism evidence for actor motion, gaze, expression, and lip-sync before runtime selection",
      },
      {
        category: "visual_qa",
        blockerIds: ["humanoid_visual_qa_evidence_not_attached"],
        recommendedNextAction: "attach screenshot or visual QA evidence for generated humanoids and equipment before learner launch review",
      },
      {
        category: "quest_evidence",
        blockerIds: ["quest_webxr_evidence_not_attached"],
        recommendedNextAction: "keep Quest/WebXR readiness blocked until foreground headset or approved local runtime evidence is attached",
      },
      {
        category: "metadata_only_assets",
        blockerIds: materializationEvidenceComplete
          ? ["materialization_evidence_refs_are_metadata_only_not_generated_asset_readiness"]
          : ["actor_equipment_materialization_evidence_attachment_incomplete"],
        recommendedNextAction: materializationEvidenceComplete
          ? "treat completed actor/equipment evidence refs as review metadata, not generated asset or runtime readiness"
          : "finish attaching actor/equipment materialization evidence refs before reviewing downstream runtime blockers",
      },
    ],
    claimBoundary: "remaining_runtime_blockers_after_materialization_metadata_only",
  };
}

function blockedReport(input: {
  generatedAt: string;
  input: {
    queueReport: EncounterAssetGenerationQueueReport;
  };
  bundleReport?: GeneratedEdStationRuntimeBundleReport;
  humanoidRealismRequirements: EncounterHumanoidRealismRequirements;
  encounterAssetNeedsReadinessManifest?: EncounterAssetGenerationQueueReport["encounterAssetNeedsReadinessManifest"];
  targets: EncounterAssetGenerationPublicationTargets;
  sceneManifestPath: string;
  learnerRuntimeBundlePath: string;
  uiXrPublicSceneManifestPath: string;
  uiXrPublicLearnerRuntimeBundlePath: string;
  remediationWorkOrderRefs?: VisualQaRemediationWorkOrderRef[];
  blockers: string[];
}): EncounterPublicationPayloadReport {
  const requiredActorRoles = input.humanoidRealismRequirements.requirements.map((requirement) => requirement.actorRole);
  const dynamicBehaviorCoverage = buildEncounterDynamicBehaviorCoverageSummary({
    learnerRuntimeBundle: null,
    requiredActorRoles,
    scenarioId: input.input.queueReport.request.scenarioId,
  });
  const encounterFactorySummary = buildEncounterFactorySummaryContracts({
    requestId: input.input.queueReport.request.requestId,
    scenarioId: input.input.queueReport.request.scenarioId,
    actorRoles: requiredActorRoles,
    requiredActorRoles,
    dynamicBehaviorCoverage,
  });

  return {
    generatedAt: input.generatedAt,
    schemaVersion: "openclinxr.encounter-publication-payloads.v1",
    status: "blocked",
    requestId: input.input.queueReport.request.requestId,
    scenarioId: input.input.queueReport.request.scenarioId,
    stationId: input.input.queueReport.request.stationId,
    publicationTargets: input.targets,
    localArtifacts: {
      sceneManifestPath: input.sceneManifestPath,
      learnerRuntimeBundlePath: input.learnerRuntimeBundlePath,
      uiXrPublicSceneManifestPath: input.uiXrPublicSceneManifestPath,
      uiXrPublicLearnerRuntimeBundlePath: input.uiXrPublicLearnerRuntimeBundlePath,
    },
    payloadSummary: {
      sceneManifestId: "not_materialized",
      roomPropCount: 0,
      learnerBundleId: "not_materialized",
      actorCount: 0,
      humanoidRequirementActorCount: input.humanoidRealismRequirements.requirements.length,
      humanoidRuntimeRequirementActorCount: 0,
      humanoidRealismProfileCount: deriveHumanoidRealismProfiles(input.input.queueReport, input.humanoidRealismRequirements).length,
      equipmentCount: 0,
      uiSurfaceCount: 0,
    },
    humanoidRealismRequirements: input.humanoidRealismRequirements,
    humanoidRealismProfiles: deriveHumanoidRealismProfiles(input.input.queueReport, input.humanoidRealismRequirements),
    humanoidRuntimeRequirements: [],
    caseDefinedHumanoidRuntimeHandoff: buildCaseDefinedHumanoidRuntimeHandoff(input.input.queueReport.plan.generationWorkOrders),
    actorEquipmentMaterializationGate: buildActorEquipmentMaterializationGate(input.bundleReport, input.materializationEvidenceReport),
    caseDefinitionDrivenFactoryCoverage: buildCaseDefinitionDrivenFactoryCoverage({
      queueReport: input.input.queueReport,
      learnerBundle: null,
    }),
    realismEvidenceRefs: buildPublicationRealismEvidenceRefs({
      requestId: input.input.queueReport.request.requestId,
      scenarioId: input.input.queueReport.request.scenarioId,
      humanoidRuntimeRequirements: [],
      equipmentIds: [],
    }),
    encounterAssetNeedsReadinessManifest: input.encounterAssetNeedsReadinessManifest,
    dynamicEncounterBehaviorCoverage: encounterFactorySummary.dynamicBehaviorCoverage,
    encounterFactoryDryRunPlan: buildEncounterFactoryDryRunPlan({
      queueReport: input.input.queueReport,
      humanoidRealismProfiles: deriveHumanoidRealismProfiles(input.input.queueReport, input.humanoidRealismRequirements),
      humanoidRuntimeRequirements: [],
      blocked: true,
    }),
    localMaterializationHandoffManifest: buildEncounterWorkerMaterializationPlan({
      request: input.input.queueReport.request,
      workOrders: input.input.queueReport.plan.generationWorkOrders,
    }),
    ...(input.remediationWorkOrderRefs?.length ? { remediationWorkOrderRefs: input.remediationWorkOrderRefs } : {}),
    ...(input.input.queueReport.projectionArtifactConsumption
      ? { projectionArtifactConsumption: input.input.queueReport.projectionArtifactConsumption }
      : {}),
    operationalNotes: buildEncounterOperationalBoundaryNotes(),
    evidenceBoundaries: boundary({ localPayloadsMaterialized: false }),
    blockers: [...input.blockers],
  };
}

function deriveHumanoidRealismRequirementsFromBundle(
  bundleReport: GeneratedEdStationRuntimeBundleReport,
): EncounterHumanoidRealismRequirements {
  const actorRoles = bundleReport.learnerBundle?.actors.map((actor) => actor.role) ?? ["patient"];
  return {
    schemaVersion: "openclinxr.encounter-humanoid-realism-requirements.v1",
    source: "scenario_actor_definitions",
    requirements: actorRoles.map((actorRole) => ({
      actorRole,
      requiredAssetKinds: [
        "generated_humanoid_mesh",
        "skin_material_or_morph_targets",
        "clinical_idle_animation",
        "conversation_animation",
        "viseme_phoneme_map",
        "gaze_blink_control",
        "role_appropriate_clothing",
      ],
      requiredSignalIds: [
        ...ENCOUNTER_HUMANOID_RUNTIME_REQUIRED_SIGNAL_IDS,
      ],
    })),
    notEvidenceFor: [
      "production_asset_readiness",
      "quest_readiness",
      "clinical_validity",
      "scoring_validity",
    ],
  };
}

function summarizePayloads(
  sceneManifest: EncounterRuntimeSceneManifest,
  learnerBundle: LearnerRuntimeAssetBundle,
  humanoidRealismRequirements: EncounterHumanoidRealismRequirements,
  humanoidRealismProfiles: EncounterAssetGenerationQueueReport["humanoidRealismProfiles"],
): EncounterPublicationPayloadReport["payloadSummary"] {
  return {
    sceneManifestId: sceneManifest.manifestId,
    roomPropCount: sceneManifest.roomProps.length,
    learnerBundleId: learnerBundle.bundleId,
    actorCount: learnerBundle.actors.length,
    humanoidRequirementActorCount: humanoidRealismRequirements.requirements.length,
    humanoidRuntimeRequirementActorCount: buildHumanoidRuntimeRequirements(learnerBundle, humanoidRealismRequirements).length,
    humanoidRealismProfileCount: humanoidRealismProfiles.length,
    equipmentCount: learnerBundle.equipment.length,
    uiSurfaceCount: learnerBundle.uiSurfaces.length,
  };
}

function deriveHumanoidRealismProfiles(
  queueReport: EncounterAssetGenerationQueueReport,
  humanoidRealismRequirements: EncounterHumanoidRealismRequirements,
): EncounterAssetGenerationQueueReport["humanoidRealismProfiles"] {
  if (Array.isArray(queueReport.humanoidRealismProfiles)) {
    return queueReport.humanoidRealismProfiles;
  }
  return humanoidRealismRequirements.requirements.map((requirement) => ({
    actorRole: requirement.actorRole,
    ...(requirement.realismProfile ?? {
      ageBand: requirement.actorRole === "patient" ? "adult" : "contextual_adult",
      bodyPostureNotes: ["clinical_idle_pose_must_match_encounter_context"],
      clothingClinicalContextCues: [`${requirement.actorRole}_role_appropriate_clothing`],
      expressionAffectCues: ["subtle_blink_and_micro_saccade_motion"],
      mobilityPositioningConstraints: ["movement_must_preserve_clinical_spatial_blocking"],
      requiredRealismEvidenceIds: [...requirement.requiredSignalIds],
      claimScope: "metadata_only_not_visual_quality_evidence" as const,
    }),
  }));
}

function buildHumanoidRuntimeRequirements(
  learnerBundle: LearnerRuntimeAssetBundle,
  humanoidRealismRequirements: EncounterHumanoidRealismRequirements,
): EncounterPublicationHumanoidRuntimeRequirement[] {
  const requirementsByRole = new Map(humanoidRealismRequirements.requirements.map((requirement) => [requirement.actorRole, requirement]));
  return learnerBundle.actors
    .filter((actor) => actor.embodiment !== "virtual_device" && actor.embodiment !== "voice_only")
    .map((actor) => {
      const requirement = requirementsByRole.get(actor.role);
      return {
        actorId: actor.actorId,
        actorRole: actor.role,
        modelAssetId: actor.model.assetId,
        requiredAssetKinds: [...(requirement?.requiredAssetKinds ?? [])],
        requiredSignalIds: uniqueStrings([
          ...(requirement?.requiredSignalIds ?? []),
          ...ENCOUNTER_HUMANOID_RUNTIME_REQUIRED_SIGNAL_IDS,
        ]),
        gazeTargetRequired: true,
        visemeMapRequired: true,
        notEvidenceFor: [
          "production_asset_readiness",
          "quest_readiness",
          "clinical_validity",
          "scoring_validity",
        ],
      };
    });
}

function buildPublicationRealismEvidenceRefs(input: {
  requestId: string;
  scenarioId: string;
  humanoidRuntimeRequirements: EncounterPublicationHumanoidRuntimeRequirement[];
  equipmentIds: string[];
}): EncounterPublicationRealismEvidenceRefs {
  const base = `encounter-publication-realism://${input.scenarioId}/${input.requestId}`;
  const humanoidRuntimeRequirementCount = input.humanoidRuntimeRequirements.length;
  return {
    schemaVersion: "openclinxr.encounter-publication-realism-evidence-refs.v1",
    claimBoundary: "metadata_only_not_runtime_or_visual_quality_evidence",
    refs: [
      "humanoid-realism-gate",
      "runtime-realism-evidence-check",
      "visual-qa-evidence-check",
    ].map((refId) => ({
      refId: refId as EncounterPublicationRealismEvidenceRefs["refs"][number]["refId"],
      evidenceRef: `${base}/${refId}/${humanoidRuntimeRequirementCount}-actors`,
      requiredBefore: "guarded_runtime_wiring",
      status: "required_not_attached",
      notEvidenceFor: [
        "production_asset_readiness",
        "quest_readiness",
        "clinical_validity",
        "scoring_validity",
      ],
    })),
    runtimeRealismEvidenceHooks: input.humanoidRuntimeRequirements.map((requirement) => ({
      actorId: requirement.actorId,
      actorRole: requirement.actorRole,
      requiredSignalIds: [...requirement.requiredSignalIds],
      evidenceRef: `${base}/runtime-realism-evidence-check/${requirement.actorRole}/${requirement.actorId}`,
      status: "required_not_attached",
      claimBoundary: "runtime_realism_hook_metadata_only_not_runtime_readiness",
    })),
    visualQaEvidenceHooks: [
      ...input.humanoidRuntimeRequirements.map((requirement) => ({
        targetId: requirement.actorId,
        targetKind: "humanoid_actor" as const,
        requiredReviewFocus: ["face_gaze_lip_sync_expression", "locomotion_pose"] as const,
        evidenceRef: `${base}/visual-qa-evidence-check/humanoid/${requirement.actorRole}/${requirement.actorId}`,
        status: "required_not_attached" as const,
        claimBoundary: "visual_qa_hook_metadata_only_not_visual_quality_evidence" as const,
      })),
      ...uniqueStrings(input.equipmentIds).map((equipmentId) => ({
        targetId: equipmentId,
        targetKind: "equipment" as const,
        requiredReviewFocus: ["equipment_scale_placement_affordance"] as const,
        evidenceRef: `${base}/visual-qa-evidence-check/equipment/${equipmentId}`,
        status: "required_not_attached" as const,
        claimBoundary: "visual_qa_hook_metadata_only_not_visual_quality_evidence" as const,
      })),
    ],
    runtimeExecutionAllowed: false,
    providerExecutionPerformed: false,
    questReadinessClaimed: false,
  };
}

// The local full dry-run plan intentionally remains tooling-owned because it carries
// stage input/output refs for operator review; exported summaries are derived through
// buildEncounterFactoryDryRunSummary so nextAction, boundaries, and summary shape do not drift.
function buildEncounterFactoryDryRunPlan(input: {
  queueReport: EncounterAssetGenerationQueueReport;
  humanoidRealismProfiles: EncounterAssetGenerationQueueReport["humanoidRealismProfiles"];
  humanoidRuntimeRequirements: EncounterPublicationHumanoidRuntimeRequirement[];
  blocked: boolean;
}): EncounterFactoryDryRunPlan {
  const actorRoles = uniqueStrings(input.humanoidRealismProfiles.map((profile) => profile.actorRole));
  const sharedSummary = buildEncounterFactoryDryRunSummary({
    requestId: input.queueReport.request.requestId,
    scenarioId: input.queueReport.request.scenarioId,
    actorRoles,
    blockedPendingRuntimeBundle: input.blocked,
  });
  const status = sharedSummary.status;
  const stageStatus = input.blocked ? "blocked_pending_runtime_bundle" : "planned_metadata_only";
  const generationWorkOrders = [...(input.queueReport.plan.generationWorkOrders ?? [])];
  const stages: EncounterFactoryDryRunPlan["stages"] = [
    {
      stageId: "scenario_definition_to_asset_requirements",
      inputRefs: [input.queueReport.request.scenarioId, input.queueReport.request.requestId],
      outputRefs: input.queueReport.plan.stages.map((stage) => stage.stage),
      reviewGateIds: ["scenario_configuration_review"],
      status: stageStatus,
    },
    {
      stageId: "generation_work_order_routing_plan",
      inputRefs: generationWorkOrders.map((workOrder) => workOrder.workOrderId),
      outputRefs: uniqueStrings(generationWorkOrders.flatMap((workOrder) => [
        workOrder.targetKind,
        workOrder.capabilityId,
        workOrder.providerRoute,
        ...workOrder.visualQaBlockerRefs,
      ])),
      reviewGateIds: ["asset_pipeline", "adversarial_visual_qa_review", "model_provider_policy_review"],
      status: stageStatus,
    },
    {
      stageId: "humanoid_roles_to_realism_profiles",
      inputRefs: actorRoles,
      outputRefs: input.humanoidRealismProfiles.flatMap((profile) => profile.requiredRealismEvidenceIds),
      reviewGateIds: ["humanoid_profile_review", "dialogue_viseme_gaze_review"],
      status: stageStatus,
    },
    {
      stageId: "runtime_bundle_binding_plan",
      inputRefs: input.humanoidRuntimeRequirements.map((requirement) => requirement.modelAssetId),
      outputRefs: input.humanoidRuntimeRequirements.map((requirement) => requirement.actorId),
      reviewGateIds: ["runtime_asset_review", "learner_runtime_boundary_review"],
      status: stageStatus,
    },
    {
      stageId: "publication_and_evidence_gate_plan",
      inputRefs: [input.queueReport.request.encounterId],
      outputRefs: [
        "scene_manifest",
        "learner_runtime_asset_bundle",
        "runtime_realism_evidence",
        "emotion_aligned_expression_transition_cue",
        "visual_qa_evidence",
        "emotion_expression_transition_readability",
        "quest_runtime_evidence",
      ],
      reviewGateIds: ["asset_pipeline", "clinical_simulation", "xr_performance", "security_privacy"],
      status: stageStatus,
    },
  ];

  return {
    schemaVersion: "openclinxr.encounter-factory-dry-run-plan.v1",
    planId: `${input.queueReport.request.requestId}:dry-run-plan:v1`,
    status,
    sourceRequestId: input.queueReport.request.requestId,
    sourceScenarioId: input.queueReport.request.scenarioId,
    actorRoles,
    stageCount: stages.length,
    generationWorkOrders,
    stages,
    reviewPosture: {
      requiredReviewerRoles: ["asset_pipeline", "clinical_simulation", "xr_performance", "security_privacy"],
      nextAction: sharedSummary.recommendedNextAction === "attach_runtime_asset_review_decisions"
        ? "review_factory_plan_before_generation_or_publication"
        : sharedSummary.recommendedNextAction,
      claimBoundary: "encounter_factory_dry_run_not_asset_generation",
    },
    evidenceBoundaries: sharedSummary.evidenceBoundaries,
  };
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function boundary(input: { localPayloadsMaterialized: boolean }): EncounterPublicationPayloadReport["evidenceBoundaries"] {
  return {
    localPayloadsMaterialized: input.localPayloadsMaterialized,
    dynamicEncounterPayload: true,
    runtimeHardcodingRequired: false,
    azureCloudOperationPerformed: false,
    mongoWritePerformed: false,
    paidApisUsed: false,
    productionReadinessClaimed: false,
    questReadinessClaimed: false,
    clinicalValidityClaimed: false,
    scoringValidityClaimed: false,
  };
}

function validatePublicationRealismEvidenceRefs(value: unknown, pathName: string, errors: string[]): void {
  requireRecord(value, pathName, errors);
  if (!isRecord(value)) return;
  requireLiteral(value.schemaVersion, "openclinxr.encounter-publication-realism-evidence-refs.v1", `${pathName}/schemaVersion`, errors);
  requireLiteral(value.claimBoundary, "metadata_only_not_runtime_or_visual_quality_evidence", `${pathName}/claimBoundary`, errors);
  requireLiteral(value.runtimeExecutionAllowed, false, `${pathName}/runtimeExecutionAllowed`, errors);
  requireLiteral(value.providerExecutionPerformed, false, `${pathName}/providerExecutionPerformed`, errors);
  requireLiteral(value.questReadinessClaimed, false, `${pathName}/questReadinessClaimed`, errors);
  requireArray(value.refs, `${pathName}/refs`, errors);
  requireArray(value.runtimeRealismEvidenceHooks, `${pathName}/runtimeRealismEvidenceHooks`, errors);
  requireArray(value.visualQaEvidenceHooks, `${pathName}/visualQaEvidenceHooks`, errors);
  if (!Array.isArray(value.refs)) return;
  value.refs.forEach((ref, index) => {
    const refPath = `${pathName}/refs/${index}`;
    if (!isRecord(ref)) {
      errors.push(`${refPath} must be object`);
      return;
    }
    requireOneOf(ref.refId, ["humanoid-realism-gate", "runtime-realism-evidence-check", "visual-qa-evidence-check"], `${refPath}/refId`, errors);
    requireString(ref.evidenceRef, `${refPath}/evidenceRef`, errors);
    requireLiteral(ref.requiredBefore, "guarded_runtime_wiring", `${refPath}/requiredBefore`, errors);
    requireLiteral(ref.status, "required_not_attached", `${refPath}/status`, errors);
    for (const notEvidenceFor of ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"]) {
      requireStringArrayIncludes(ref.notEvidenceFor, notEvidenceFor, `${refPath}/notEvidenceFor`, errors);
    }
  });
}

async function latestVisualQaRemediationWorkOrderRefsForScenario(
  scenarioId: string,
): Promise<VisualQaRemediationWorkOrderRef[] | undefined> {
  const files = await globFiles("docs/openclinxr/visual-qa-evidence-*.json");
  const candidates = await Promise.all(files.map(async (filePath) => {
    try {
      const report = await readJson<unknown>(filePath);
      if (!isRecord(report) || !isRecord(report.evidence) || !isRecord(report.evidence.capture)) {
        return undefined;
      }
      if (report.evidence.capture.scenarioId !== scenarioId || !Array.isArray(report.remediationWorkOrderRefs) || report.remediationWorkOrderRefs.length === 0) {
        return undefined;
      }
      return {
        filePath,
        mtimeMs: (await stat(filePath)).mtimeMs,
        refs: report.remediationWorkOrderRefs as VisualQaRemediationWorkOrderRef[],
      };
    } catch {
      return undefined;
    }
  }));

  return candidates
    .filter((candidate): candidate is {
      filePath: string;
      mtimeMs: number;
      refs: VisualQaRemediationWorkOrderRef[];
    } => candidate !== undefined)
    .sort((left, right) => left.mtimeMs - right.mtimeMs || left.filePath.localeCompare(right.filePath))
    .at(-1)?.refs;
}

function validateVisualQaRemediationWorkOrderRefs(
  value: unknown,
  pathName: string,
  errors: string[],
): void {
  requireArray(value, pathName, errors);
  if (!Array.isArray(value)) return;
  value.forEach((ref, index) => {
    const refPath = `${pathName}/${index}`;
    if (!isRecord(ref)) {
      errors.push(`${refPath} must be object`);
      return;
    }
    requireLiteral(ref.schemaVersion, "openclinxr.visual-qa-remediation-work-order-ref.v1", `${refPath}/schemaVersion`, errors);
    requireString(ref.scenarioId, `${refPath}/scenarioId`, errors);
    requireString(ref.sourceEvidenceRef, `${refPath}/sourceEvidenceRef`, errors);
    requireString(ref.blockerId, `${refPath}/blockerId`, errors);
    requireString(ref.targetKind, `${refPath}/targetKind`, errors);
    requireString(ref.capabilityId, `${refPath}/capabilityId`, errors);
    requireString(ref.workOrderRef, `${refPath}/workOrderRef`, errors);
    requireLiteral(ref.status, "planned_metadata_only", `${refPath}/status`, errors);
    requireString(ref.recommendedWorkerAction, `${refPath}/recommendedWorkerAction`, errors);
    requireArray(ref.notEvidenceFor, `${refPath}/notEvidenceFor`, errors);
    if (Array.isArray(ref.notEvidenceFor)) {
      for (const notEvidenceFor of [
        "production_asset_readiness",
        "quest_readiness",
        "clinical_validity",
        "scoring_validity",
      ] as const) {
        requireStringArrayIncludes(ref.notEvidenceFor, notEvidenceFor, `${refPath}/notEvidenceFor`, errors);
      }
    }
  });
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {
    validateLatest: false,
  };
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--queue-report") {
      options.queueReportPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--bundle-report") {
      options.bundleReportPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--materialization-evidence-report") {
      options.materializationEvidenceReportPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--materialization-evidence-attachments") {
      options.materializationEvidenceAttachmentsPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--output") {
      options.outputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--validate") {
      options.validatePath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--validate-latest") {
      options.validateLatest = true;
      continue;
    }
    if (arg === "--summarize-dry-run-plan") {
      options.summarizeDryRunPlanPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--projection-artifact") {
      options.projectionArtifactPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }
  return options;
}

async function latestPath(pattern: string): Promise<string | undefined> {
  const files = await globFiles(pattern);
  const filesWithStats = await Promise.all(files.map(async (filePath) => ({ filePath, mtimeMs: (await stat(filePath)).mtimeMs })));
  return filesWithStats.sort((left, right) => left.mtimeMs - right.mtimeMs || left.filePath.localeCompare(right.filePath)).at(-1)?.filePath;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function requireRecord(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) errors.push(`${path} must be object`);
}

function requireArray(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) errors.push(`${path} must be array`);
}

function requireString(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0) errors.push(`${path} must be non-empty string`);
}

function requireNumber(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) errors.push(`${path} must be number`);
}

function requireLiteral(value: unknown, expected: string | number | boolean, path: string, errors: string[]): void {
  if (value !== expected) errors.push(`${path} must be ${JSON.stringify(expected)}`);
}

function requireOneOf(value: unknown, expectedValues: string[], path: string, errors: string[]): void {
  if (!expectedValues.includes(String(value))) errors.push(`${path} must be one of ${expectedValues.join(", ")}`);
}

function requireStringArrayIncludes(value: unknown, expected: string, path: string, errors: string[]): void {
  if (!Array.isArray(value) || !value.includes(expected)) {
    errors.push(`${path} must include ${expected}`);
  }
}

function validateRoleCoveragePartition(input: {
  path: string;
  covered: unknown;
  missing: unknown;
  requiredActorRoles: string[];
  missingBlockerPrefix: string;
  blockerIds: string[];
  errors: string[];
}): void {
  requireArray(input.covered, `${input.path}/coveredActorRoles`, input.errors);
  requireArray(input.missing, `${input.path}/missingActorRoles`, input.errors);
  if (!Array.isArray(input.covered) || !Array.isArray(input.missing)) return;

  const covered = input.covered.filter((actorRole): actorRole is string => typeof actorRole === "string");
  const missing = input.missing.filter((actorRole): actorRole is string => typeof actorRole === "string");
  const coveredOrMissing = new Set([...covered, ...missing]);
  requireKnownActorRoles(covered, input.requiredActorRoles, `${input.path}/coveredActorRoles`, input.errors);
  requireKnownActorRoles(missing, input.requiredActorRoles, `${input.path}/missingActorRoles`, input.errors);

  for (const actorRole of input.requiredActorRoles) {
    if (!coveredOrMissing.has(actorRole)) {
      input.errors.push(`${input.path} must cover or mark missing actor role ${actorRole}`);
    }
    if (missing.includes(actorRole) && !input.blockerIds.includes(`${input.missingBlockerPrefix}:${actorRole}`)) {
      input.errors.push(`/dynamicEncounterBehaviorCoverage/blockerIds must include ${input.missingBlockerPrefix}:${actorRole}`);
    }
  }
}

function requireKnownActorRoles(value: unknown, requiredActorRoles: string[], path: string, errors: string[]): void {
  requireArray(value, path, errors);
  if (!Array.isArray(value)) return;
  const required = new Set(requiredActorRoles);
  for (const actorRole of value) {
    if (typeof actorRole !== "string" || !required.has(actorRole)) {
      errors.push(`${path} must only include required humanoid actor roles`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}

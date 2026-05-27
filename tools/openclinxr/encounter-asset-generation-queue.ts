import {
  buildEncounterAssetGenerationPlan,
  createEncounterAssetGenerationQueueMessage,
  decodeAzureStorageQueueMessage,
  encodeAzureStorageQueueMessage,
  type EncounterHumanoidRealismRequirements,
  type EncounterExecutableAssetGenerationRequest,
} from "../../packages/openclinxr/capability-gateway/src/index.js";
import { ENCOUNTER_HUMANOID_RUNTIME_REQUIRED_SIGNAL_IDS } from "../../packages/openclinxr/asset-registry/src/runtime-bundles.js";
import {
  buildEncounterAssetNeedsReadinessManifest,
  type EncounterAssetNeedsReadinessManifest,
} from "../../packages/openclinxr/asset-registry/src/index.js";
import { findScenarioFixtureById } from "../../packages/openclinxr/scenario-fixtures/src/index.js";
import {
  buildDynamicEncounterFactoryPlanningProjection,
  type DynamicEncounterFactoryPlanningScenario,
} from "../../packages/openclinxr/scenario-fixtures/src/scenario-bank.js";
import {
  validateDynamicEncounterFactoryProjectionArtifact,
  type DynamicEncounterFactoryProjectionArtifact,
} from "../../packages/openclinxr/shared-schemas/src/index.js";
import { globFiles, readJson, writeJson } from "../agent-factory/lib.js";
import { stat } from "node:fs/promises";
import type { Scenario } from "../../packages/openclinxr/shared-schemas/src/index.js";

type CliOptions = {
  outputPath?: string;
  scenarioId?: string;
  projectionArtifactPath?: string;
  stdout: boolean;
  validatePath?: string;
  validateLatest: boolean;
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

export type ProjectionArtifactSharedAssetReuseSummary = {
  scenarioBankSliceScenarioIds: string[];
  scenarioBankSliceSize: number;
  workOrderCount: number;
  distinctLookupKeys: string[];
  distinctSharedLibraryBlobPrefixes: string[];
  sharedLibraryMongooseCollectionName: "shared_encounter_asset_library";
};

export type EncounterHumanoidRealismProfile = {
  actorRole: string;
  ageBand: "adult" | "child_or_adolescent" | "contextual_adult";
  bodyPostureNotes: string[];
  clothingClinicalContextCues: string[];
  expressionAffectCues: string[];
  mobilityPositioningConstraints: string[];
  requiredRealismEvidenceIds: string[];
  claimScope: "metadata_only_not_visual_quality_evidence";
};

type OperationalBoundaryNote = {
  claimBoundary: "provider_gate_metadata_not_live_provider_readiness" | "local_only_asset_pipeline_metadata_not_live_provider_readiness";
  executionEnabled: false;
  externalProviderExecutionAttempted: false;
  liveProviderReady: false;
  credentialEvidencePresent: false;
  runtimeEvidencePresent: false;
  reportMetadataOnly: true;
  surfacedInQueueReport: true;
  missingEvidenceIds: string[];
  notEvidenceFor: Array<
    | "provider_runtime_readiness"
    | "generated_asset_quality"
    | "production_asset_readiness"
    | "quest_readiness"
    | "clinical_validity"
    | "scoring_validity"
  >;
  recommendedNextAction: string;
};

export type EncounterAssetGenerationQueueReport = {
  generatedAt: string;
  schemaVersion: "openclinxr.encounter-asset-generation-queue-report.v1";
  status: "planned";
  queue: {
    queueName: "encounter-asset-generation";
    messageKind: "encounter_definition_to_executable_encounter";
    encodedMessage: string;
    encodedMessageBytes: number;
    visibilityTimeoutSeconds: number;
    timeToLiveSeconds: number;
    dequeueAttemptLimit: number;
  };
  request: EncounterExecutableAssetGenerationRequest;
  plan: ReturnType<typeof buildEncounterAssetGenerationPlan>;
  encounterAssetNeedsReadinessManifest?: EncounterAssetNeedsReadinessManifest;
  storageTargets: {
    blobStoreKind: EncounterExecutableAssetGenerationRequest["targetAssetStore"]["storeKind"];
    blobContainerName: string;
    blobPrefix: string;
    durableStateStoreKind: EncounterExecutableAssetGenerationRequest["persistenceTarget"]["storeKind"];
    durableStateCollectionName: "encounter_asset_generation_jobs";
  };
  operationalNotes: {
    longRunningOptimizationAccepted: true;
    expectedMinimumHours: number;
    expectedMaximumHours: number;
    mayRunForDays: boolean;
    checkpointIntervalMinutes: number;
    generatedAssetsMustRemainDynamic: true;
    sceneIsNotHardcodedInRuntime: true;
    providerDisabledBoundary: OperationalBoundaryNote;
    localOnlyBoundary: OperationalBoundaryNote;
  };
  humanoidRealismRequirements?: EncounterHumanoidRealismRequirements;
  caseDefinedHumanoidPerformanceContract?: DynamicEncounterFactoryPlanningScenario["humanoidPerformanceContract"];
  caseDefinedHumanoidPerformanceWorkOrderCoverage?: {
    claimBoundary: "case_definition_humanoid_contract_to_work_order_coverage_metadata_only";
    scenarioId: string;
    actorRoles: string[];
    actorRoleCoverage: Array<{
      actorRole: string;
      humanoidWorkOrderId: string | null;
      animationWorkOrderId: string | null;
      requiredSignalIds: string[];
    }>;
    missingActorRoles: string[];
    notEvidenceFor: Array<"generated_humanoid_asset_readiness" | "animation_quality" | "quest_readiness" | "runtime_readiness" | "clinical_validity">;
  };
  humanoidRealismProfiles: EncounterHumanoidRealismProfile[];
  projectionArtifactConsumption?: {
    source: "scenario_bank_dynamic_encounter_factory_projection_artifact";
    sourceSchemaVersion: "openclinxr.dynamic-encounter-factory-projection-artifact.v1";
    anchorScenarioId: string;
    nextFactoryPlanningScenarioId: string | null;
    nextFactoryPlanningScenarioSelectionMode: DynamicEncounterFactoryProjectionArtifact["nextFactoryPlanningScenarioSelectionMode"];
    scenarioBankSliceSize: number;
    factorySelectionMetadata?: {
      scenarioBankOrder: number;
      factorySelectionRole: "anchor" | "next_factory_planning_scenario" | "candidate";
      factorySelectionMode: "approved_encounter_variant" | "next_scenario_fallback" | "anchor_not_found";
      factorySelectionClaimBoundary: "review_gated_factory_metadata_only";
      metadataOnly: true;
      generationApprovalInferred: false;
    };
    sharedAssetReuseSummary?: ProjectionArtifactSharedAssetReuseSummary;
    caseDefinedHumanoidPerformanceContract?: DynamicEncounterFactoryPlanningScenario["humanoidPerformanceContract"];
  };
  evidenceBoundaries: {
    azureQueueMessagePrepared: true;
    azuriteCompatible: true;
    azureCloudOperationPerformed: false;
    paidApisUsed: false;
    productionDeploymentPerformed: false;
    productionReadinessClaimed: false;
    questReadinessClaimed: false;
    clinicalValidityClaimed: false;
    scoringValidityClaimed: false;
  };
};

const defaultOutputPath = `docs/openclinxr/encounter-asset-generation-queue-${new Date().toISOString().slice(0, 10)}.json`;

const providerDisabledBoundaryMissingEvidenceIds = [
  "provider_credentials_or_operator_approval_missing",
  "provider_runtime_evidence_missing",
];

const localOnlyBoundaryMissingEvidenceIds = [
  "local_blender_ffmpeg_toolchain_evidence_missing",
  "hunyuan3d_local_install_license_cache_evidence_missing",
  "shared_asset_library_lru_reuse_evidence_missing",
  "azurite_or_queue_emulator_evidence_missing",
  "durable_job_checkpoint_evidence_missing",
];

const notEvidenceForAllReadinessClaims = [
  "provider_runtime_readiness",
  "generated_asset_quality",
  "production_asset_readiness",
  "quest_readiness",
  "clinical_validity",
  "scoring_validity",
] as const;

async function main(): Promise<void> {
  await runEncounterAssetGenerationQueueCli(process.argv.slice(2));
}

export async function runEncounterAssetGenerationQueueCli(args: string[]): Promise<void> {
  const options = parseArgs(args);

  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestPath("docs/openclinxr/encounter-asset-generation-queue-*.json");
    if (!validatePath) {
      throw new Error("Missing encounter asset generation queue report to validate.");
    }
    const validation = validateEncounterAssetGenerationQueueReport(await readJson<unknown>(validatePath));
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }
    for (const error of validation.errors) {
      console.error(error);
    }
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

  if (options.scenarioId && options.projectionArtifactPath) {
    throw new Error("Use either --scenario-id or --projection-artifact, not both.");
  }

  const report = buildEncounterAssetGenerationQueueReport({
    ...(options.scenarioId ? { request: buildEncounterAssetGenerationRequestForScenario(options.scenarioId) } : {}),
    ...(projectionArtifact
      ? { projectionArtifact: projectionArtifact as DynamicEncounterFactoryProjectionArtifact }
      : {}),
  });
  if (options.stdout) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const outputPath = options.outputPath ?? defaultOutputPath;
  await writeJson(outputPath, report);
  console.log(`Wrote ${outputPath}`);
}

export function buildEncounterAssetGenerationQueueReport(input: {
  generatedAt?: string;
  request?: EncounterExecutableAssetGenerationRequest;
  projectionArtifact?: DynamicEncounterFactoryProjectionArtifact;
} = {}): EncounterAssetGenerationQueueReport {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const projectionArtifact = input.projectionArtifact;
  const scenarioFromArtifact = projectionArtifact?.scenarioBankSlice.find(
    (scenario) => scenario.scenarioId === projectionArtifact.nextFactoryPlanningScenarioId,
  );
  const factoryPlanningScenario = projectionArtifact && scenarioFromArtifact
    ? buildDynamicEncounterFactoryPlanningProjection(
        projectionArtifact.scenarioBankSlice,
        projectionArtifact.anchorScenarioId,
      ).scenarios.find((scenario) => scenario.scenarioId === scenarioFromArtifact.scenarioId)
    : undefined;
  const factorySelectionSummary = factoryPlanningScenario?.encounterFactoryInputSummary;
  const caseDefinedHumanoidPerformanceContract = factoryPlanningScenario?.humanoidPerformanceContract;
  const encounterFactoryInputSummary = factorySelectionSummary && caseDefinedHumanoidPerformanceContract
    ? { ...factorySelectionSummary, humanoidPerformanceContract: caseDefinedHumanoidPerformanceContract }
    : factorySelectionSummary;
  const request = input.request
    ? input.request
    : buildEncounterAssetGenerationRequestForScenario(
        projectionArtifact?.nextFactoryPlanningScenarioId ?? projectionArtifact?.anchorScenarioId ?? "ed_chest_pain_priority_v1",
        scenarioFromArtifact,
        encounterFactoryInputSummary,
      );
  const scenarioFixture = findScenarioFixtureById(request.scenarioId, scenarioFromArtifact ? [scenarioFromArtifact] : undefined);
  const encounterAssetNeedsReadinessManifest = scenarioFixture
    ? buildEncounterAssetNeedsReadinessManifest(scenarioFixture)
    : undefined;
  const message = createEncounterAssetGenerationQueueMessage(request);
  const encodedMessage = encodeAzureStorageQueueMessage(message);
  const decodedMessage = decodeAzureStorageQueueMessage(encodedMessage);
  const plan = buildEncounterAssetGenerationPlan(decodedMessage);
  const sharedAssetReuseSummary = projectionArtifact
    ? buildProjectionArtifactSharedAssetReuseSummary({ projectionArtifact, plan })
    : undefined;
  const caseDefinedHumanoidPerformanceWorkOrderCoverage = caseDefinedHumanoidPerformanceContract
    ? buildCaseDefinedHumanoidPerformanceWorkOrderCoverage({
        scenarioId: request.scenarioId,
        contract: caseDefinedHumanoidPerformanceContract,
        plan,
        humanoidRealismRequirements: request.humanoidRealismRequirements,
      })
    : undefined;

  return {
    generatedAt,
    schemaVersion: "openclinxr.encounter-asset-generation-queue-report.v1",
    status: "planned",
    queue: {
      queueName: message.queueName,
      messageKind: message.messageKind,
      encodedMessage,
      encodedMessageBytes: Buffer.byteLength(encodedMessage, "utf8"),
      visibilityTimeoutSeconds: message.visibilityTimeoutSeconds,
      timeToLiveSeconds: message.timeToLiveSeconds,
      dequeueAttemptLimit: message.dequeueAttemptLimit,
    },
    request,
    plan,
    storageTargets: {
      blobStoreKind: request.targetAssetStore.storeKind,
      blobContainerName: request.targetAssetStore.containerName,
      blobPrefix: request.targetAssetStore.blobPrefix,
      durableStateStoreKind: request.persistenceTarget.storeKind,
      durableStateCollectionName: request.persistenceTarget.collectionName,
    },
    operationalNotes: {
      longRunningOptimizationAccepted: true,
      expectedMinimumHours: request.optimizationWindow.expectedMinimumHours,
      expectedMaximumHours: request.optimizationWindow.expectedMaximumHours,
      mayRunForDays: request.optimizationWindow.mayRunForDays,
      checkpointIntervalMinutes: request.optimizationWindow.checkpointIntervalMinutes,
      generatedAssetsMustRemainDynamic: true,
      sceneIsNotHardcodedInRuntime: true,
      providerDisabledBoundary: {
        claimBoundary: "provider_gate_metadata_not_live_provider_readiness",
        executionEnabled: false,
        externalProviderExecutionAttempted: false,
        liveProviderReady: false,
        credentialEvidencePresent: false,
        runtimeEvidencePresent: false,
        reportMetadataOnly: true,
        surfacedInQueueReport: true,
        missingEvidenceIds: [...providerDisabledBoundaryMissingEvidenceIds],
        notEvidenceFor: [...notEvidenceForAllReadinessClaims],
        recommendedNextAction: "keep_live_provider_generation_disabled_until_operator_approval_and_runtime_evidence_exist",
      },
      localOnlyBoundary: {
        claimBoundary: "local_only_asset_pipeline_metadata_not_live_provider_readiness",
        executionEnabled: false,
        externalProviderExecutionAttempted: false,
        liveProviderReady: false,
        credentialEvidencePresent: false,
        runtimeEvidencePresent: false,
        reportMetadataOnly: true,
        surfacedInQueueReport: true,
        missingEvidenceIds: [...localOnlyBoundaryMissingEvidenceIds],
        notEvidenceFor: [...notEvidenceForAllReadinessClaims],
        recommendedNextAction: "attach_local_toolchain_and_queue_emulator_evidence_before_claiming_live_generation",
      },
    },
    ...(request.humanoidRealismRequirements
      ? { humanoidRealismRequirements: request.humanoidRealismRequirements }
      : {}),
    ...(caseDefinedHumanoidPerformanceContract
      ? { caseDefinedHumanoidPerformanceContract }
      : {}),
    ...(caseDefinedHumanoidPerformanceWorkOrderCoverage
      ? { caseDefinedHumanoidPerformanceWorkOrderCoverage }
      : {}),
    ...(encounterAssetNeedsReadinessManifest ? { encounterAssetNeedsReadinessManifest } : {}),
    humanoidRealismProfiles: buildHumanoidRealismProfiles(request),
    ...(projectionArtifact
      ? {
        projectionArtifactConsumption: {
          source: "scenario_bank_dynamic_encounter_factory_projection_artifact",
          sourceSchemaVersion: "openclinxr.dynamic-encounter-factory-projection-artifact.v1",
          anchorScenarioId: projectionArtifact.anchorScenarioId,
          nextFactoryPlanningScenarioId: projectionArtifact.nextFactoryPlanningScenarioId,
          nextFactoryPlanningScenarioSelectionMode: projectionArtifact.nextFactoryPlanningScenarioSelectionMode,
          scenarioBankSliceSize: projectionArtifact.scenarioBankSlice.length,
          ...(factorySelectionSummary ? {
            factorySelectionMetadata: {
              scenarioBankOrder: factorySelectionSummary.scenarioBankOrder,
              factorySelectionRole: factorySelectionSummary.factorySelectionRole,
              factorySelectionMode: factorySelectionSummary.factorySelectionMode,
              factorySelectionClaimBoundary: factorySelectionSummary.factorySelectionClaimBoundary,
              metadataOnly: true,
              generationApprovalInferred: false,
            },
          } : {}),
          ...(sharedAssetReuseSummary ? { sharedAssetReuseSummary } : {}),
          ...(caseDefinedHumanoidPerformanceContract ? { caseDefinedHumanoidPerformanceContract } : {}),
        },
      }
      : {}),
    evidenceBoundaries: {
      azureQueueMessagePrepared: true,
      azuriteCompatible: true,
      azureCloudOperationPerformed: false,
      paidApisUsed: false,
      productionDeploymentPerformed: false,
      productionReadinessClaimed: false,
      questReadinessClaimed: false,
      clinicalValidityClaimed: false,
      scoringValidityClaimed: false,
    },
  };
}

function buildProjectionArtifactSharedAssetReuseSummary(input: {
  projectionArtifact: DynamicEncounterFactoryProjectionArtifact;
  plan: ReturnType<typeof buildEncounterAssetGenerationPlan>;
}): ProjectionArtifactSharedAssetReuseSummary {
  return {
    scenarioBankSliceScenarioIds: input.projectionArtifact.scenarioBankSlice.map((scenario) => scenario.scenarioId),
    scenarioBankSliceSize: input.projectionArtifact.scenarioBankSlice.length,
    workOrderCount: input.plan.generationWorkOrders.length,
    distinctLookupKeys: Array.from(new Set(input.plan.generationWorkOrders.map((workOrder) => workOrder.sharedAssetLibraryReuse.lookupKey))),
    distinctSharedLibraryBlobPrefixes: Array.from(
      new Set(input.plan.generationWorkOrders.map((workOrder) => workOrder.sharedAssetLibraryReuse.sharedLibraryRefs.blobPrefix)),
    ),
    sharedLibraryMongooseCollectionName: "shared_encounter_asset_library",
  };
}

function buildCaseDefinedHumanoidPerformanceWorkOrderCoverage(input: {
  scenarioId: string;
  contract: NonNullable<DynamicEncounterFactoryPlanningScenario["humanoidPerformanceContract"]>;
  plan: ReturnType<typeof buildEncounterAssetGenerationPlan>;
  humanoidRealismRequirements?: EncounterHumanoidRealismRequirements;
}): NonNullable<EncounterAssetGenerationQueueReport["caseDefinedHumanoidPerformanceWorkOrderCoverage"]> {
  const actorRoles = Array.from(new Set(input.contract.interactiveActorRoles)).sort();
  const requirementSignalsByRole = new Map(
    (input.humanoidRealismRequirements?.requirements ?? []).map((requirement) => [
      normalizeHumanoidActorRole(requirement.actorRole),
      requirement.requiredSignalIds,
    ]),
  );
  const actorRoleCoverage = actorRoles.map((actorRole) => {
    const normalizedActorRole = normalizeHumanoidActorRole(actorRole);
    const humanoidWorkOrder = input.plan.generationWorkOrders.find((workOrder) =>
      workOrder.targetKind === "role_specific_humanoid_glb"
      && normalizeHumanoidActorRole(workOrder.actorRole) === normalizedActorRole
    );
    const animationWorkOrder = input.plan.generationWorkOrders.find((workOrder) =>
      workOrder.targetKind === "role_idle_animation_glb"
      && normalizeHumanoidActorRole(workOrder.actorRole) === normalizedActorRole
    );
    return {
      actorRole,
      humanoidWorkOrderId: humanoidWorkOrder?.workOrderId ?? null,
      animationWorkOrderId: animationWorkOrder?.workOrderId ?? null,
      requiredSignalIds: requirementSignalsByRole.get(normalizedActorRole) ?? [],
    };
  });
  return {
    claimBoundary: "case_definition_humanoid_contract_to_work_order_coverage_metadata_only",
    scenarioId: input.scenarioId,
    actorRoles,
    actorRoleCoverage,
    missingActorRoles: actorRoleCoverage
      .filter((coverage) => coverage.humanoidWorkOrderId === null || coverage.animationWorkOrderId === null)
      .map((coverage) => coverage.actorRole),
    notEvidenceFor: [
      "generated_humanoid_asset_readiness",
      "animation_quality",
      "quest_readiness",
      "runtime_readiness",
      "clinical_validity",
    ],
  };
}

export function validateEncounterAssetGenerationQueueReport(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["/ must be object"] };
  }

  requireLiteral(value.schemaVersion, "openclinxr.encounter-asset-generation-queue-report.v1", "/schemaVersion", errors);
  requireLiteral(value.status, "planned", "/status", errors);
  requireRecord(value.queue, "/queue", errors);
  requireRecord(value.request, "/request", errors);
  requireRecord(value.plan, "/plan", errors);
  requireRecord(value.storageTargets, "/storageTargets", errors);
  requireRecord(value.operationalNotes, "/operationalNotes", errors);
  requireRecord(value.humanoidRealismRequirements, "/humanoidRealismRequirements", errors);
  if (isRecord(value.request)) {
    const targetAssetStore = isRecord(value.request.targetAssetStore) ? value.request.targetAssetStore : {};
    requireLiteral(targetAssetStore.storeKind, "azurite_blob", "/request/targetAssetStore/storeKind", errors);
    requireRecord(value.request.policy, "/request/policy", errors);
    requireRecord(value.request.evidenceGates, "/request/evidenceGates", errors);
    if (isRecord(value.request.policy)) {
      requireLiteral(value.request.policy.allowPaidCloudApis, false, "/request/policy/allowPaidCloudApis", errors);
      requireLiteral(value.request.policy.allowProductionDeployment, false, "/request/policy/allowProductionDeployment", errors);
      requireLiteral(value.request.policy.productionReadinessClaimed, false, "/request/policy/productionReadinessClaimed", errors);
    }
    if (isRecord(value.request.evidenceGates)) {
      requireLiteral(value.request.evidenceGates.requireGeneratedSceneManifest, true, "/request/evidenceGates/requireGeneratedSceneManifest", errors);
      requireLiteral(value.request.evidenceGates.requireRuntimeBundlePublication, true, "/request/evidenceGates/requireRuntimeBundlePublication", errors);
      requireLiteral(value.request.evidenceGates.requireHumanReviewBeforeLearnerUse, true, "/request/evidenceGates/requireHumanReviewBeforeLearnerUse", errors);
      requireLiteral(value.request.evidenceGates.requireQuestEvidenceBeforeQuestReadinessClaim, true, "/request/evidenceGates/requireQuestEvidenceBeforeQuestReadinessClaim", errors);
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, "encounterAssetNeedsReadinessManifest")) {
    if (isRecord(value.encounterAssetNeedsReadinessManifest)) {
      validateEncounterAssetNeedsReadinessManifest(value.encounterAssetNeedsReadinessManifest, errors);
    } else {
      errors.push("/encounterAssetNeedsReadinessManifest must be object");
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, "projectionArtifactConsumption")) {
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
      if (value.projectionArtifactConsumption.nextFactoryPlanningScenarioId !== null && typeof value.projectionArtifactConsumption.nextFactoryPlanningScenarioId !== "string") {
        errors.push("/projectionArtifactConsumption/nextFactoryPlanningScenarioId must be string or null");
      }
      if (
        value.projectionArtifactConsumption.nextFactoryPlanningScenarioSelectionMode !== "approved_encounter_variant"
        && value.projectionArtifactConsumption.nextFactoryPlanningScenarioSelectionMode !== "next_scenario_fallback"
        && value.projectionArtifactConsumption.nextFactoryPlanningScenarioSelectionMode !== "anchor_not_found"
      ) {
        errors.push("/projectionArtifactConsumption/nextFactoryPlanningScenarioSelectionMode must be approved_encounter_variant, next_scenario_fallback, or anchor_not_found");
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
      requireRecord(
        value.projectionArtifactConsumption.caseDefinedHumanoidPerformanceContract,
        "/projectionArtifactConsumption/caseDefinedHumanoidPerformanceContract",
        errors,
      );
      validateCaseDefinedHumanoidPerformanceContract(
        value.projectionArtifactConsumption.caseDefinedHumanoidPerformanceContract,
        "/projectionArtifactConsumption/caseDefinedHumanoidPerformanceContract",
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
          isRecord(value.plan)
          && Array.isArray(value.plan.generationWorkOrders)
          && typeof value.projectionArtifactConsumption.sharedAssetReuseSummary.workOrderCount === "number"
          && value.projectionArtifactConsumption.sharedAssetReuseSummary.workOrderCount !== value.plan.generationWorkOrders.length
        ) {
          errors.push("/projectionArtifactConsumption/sharedAssetReuseSummary/workOrderCount must match /plan/generationWorkOrders length");
        }
      }
    } else {
      errors.push("/projectionArtifactConsumption must be object");
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, "caseDefinedHumanoidPerformanceContract")) {
    validateCaseDefinedHumanoidPerformanceContract(
      value.caseDefinedHumanoidPerformanceContract,
      "/caseDefinedHumanoidPerformanceContract",
      errors,
    );
    if (
      isRecord(value.caseDefinedHumanoidPerformanceContract)
      && isRecord(value.projectionArtifactConsumption)
      && isRecord(value.projectionArtifactConsumption.caseDefinedHumanoidPerformanceContract)
      && JSON.stringify(value.caseDefinedHumanoidPerformanceContract) !== JSON.stringify(value.projectionArtifactConsumption.caseDefinedHumanoidPerformanceContract)
    ) {
      errors.push("/caseDefinedHumanoidPerformanceContract must match /projectionArtifactConsumption/caseDefinedHumanoidPerformanceContract");
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, "caseDefinedHumanoidPerformanceWorkOrderCoverage")) {
    validateCaseDefinedHumanoidPerformanceWorkOrderCoverage(
      value.caseDefinedHumanoidPerformanceWorkOrderCoverage,
      "/caseDefinedHumanoidPerformanceWorkOrderCoverage",
      errors,
    );
  }
  requireArray(value.humanoidRealismProfiles, "/humanoidRealismProfiles", errors);
  requireRecord(value.evidenceBoundaries, "/evidenceBoundaries", errors);

  if (isRecord(value.queue)) {
    requireLiteral(value.queue.queueName, "encounter-asset-generation", "/queue/queueName", errors);
    requireLiteral(value.queue.messageKind, "encounter_definition_to_executable_encounter", "/queue/messageKind", errors);
    if (typeof value.queue.encodedMessage !== "string") {
      errors.push("/queue/encodedMessage must be string");
    } else {
      try {
        decodeAzureStorageQueueMessage(value.queue.encodedMessage);
      } catch (error) {
        errors.push(`/queue/encodedMessage must decode to an encounter asset generation queue message: ${errorMessage(error)}`);
      }
    }
    requireNumber(value.queue.encodedMessageBytes, "/queue/encodedMessageBytes", errors);
  }

  if (isRecord(value.plan)) {
    requireLiteral(value.plan.schemaVersion, "openclinxr.encounter-asset-generation-plan.v1", "/plan/schemaVersion", errors);
    requireLiteral(value.plan.productionReadinessClaimed, false, "/plan/productionReadinessClaimed", errors);
    requireArray(value.plan.generationWorkOrders, "/plan/generationWorkOrders", errors);
    if (Array.isArray(value.plan.generationWorkOrders)) {
      const targetKinds = new Set(value.plan.generationWorkOrders.filter(isRecord).map((workOrder) => String(workOrder.targetKind ?? "")));
      for (const requiredTargetKind of [
        "role_specific_humanoid_glb",
        "medical_equipment_glb",
        "role_idle_animation_glb",
        "visual_feedback_closure",
      ]) {
        if (!targetKinds.has(requiredTargetKind)) {
          errors.push(`/plan/generationWorkOrders must include ${requiredTargetKind}`);
        }
      }
      value.plan.generationWorkOrders.forEach((workOrder, index) => {
        if (!isRecord(workOrder)) {
          errors.push(`/plan/generationWorkOrders/${index} must be object`);
          return;
        }
        if (
          workOrder.providerRoute !== "deterministic-mock"
          && workOrder.providerRoute !== "local-runtime-planned"
          && workOrder.providerRoute !== "open-source-local-model-planned"
        ) {
          errors.push(`/plan/generationWorkOrders/${index}/providerRoute must stay on the local-only provider boundary`);
        }
        if (typeof workOrder.workOrderId !== "string" || workOrder.workOrderId.trim().length === 0) {
          errors.push(`/plan/generationWorkOrders/${index}/workOrderId must be non-empty string`);
        }
        if (typeof workOrder.capabilityId !== "string" || workOrder.capabilityId.trim().length === 0) {
          errors.push(`/plan/generationWorkOrders/${index}/capabilityId must be non-empty string`);
        }
        requireArray(workOrder.providerRoutingPreference, `/plan/generationWorkOrders/${index}/providerRoutingPreference`, errors);
        if (Array.isArray(workOrder.providerRoutingPreference) && workOrder.providerRoutingPreference.length === 0) {
          errors.push(`/plan/generationWorkOrders/${index}/providerRoutingPreference must contain at least one provider route`);
        }
        if (!isRecord(workOrder.modelProviderPolicy)) {
          errors.push(`/plan/generationWorkOrders/${index}/modelProviderPolicy must be object`);
        } else {
          requireLiteral(workOrder.modelProviderPolicy.executionStatus, "metadata_only_not_executed", `/plan/generationWorkOrders/${index}/modelProviderPolicy/executionStatus`, errors);
          requireLiteral(workOrder.modelProviderPolicy.allowPaidCloudApis, false, `/plan/generationWorkOrders/${index}/modelProviderPolicy/allowPaidCloudApis`, errors);
          requireLiteral(workOrder.modelProviderPolicy.allowExternalNetwork, false, `/plan/generationWorkOrders/${index}/modelProviderPolicy/allowExternalNetwork`, errors);
          requireLiteral(workOrder.modelProviderPolicy.providerRoutesRequireExplicitApproval, true, `/plan/generationWorkOrders/${index}/modelProviderPolicy/providerRoutesRequireExplicitApproval`, errors);
        }
        if (!isRecord(workOrder.sharedAssetLibraryReuse)) {
          errors.push(`/plan/generationWorkOrders/${index}/sharedAssetLibraryReuse must be object`);
        } else {
          requireString(workOrder.sharedAssetLibraryReuse.lookupKey, `/plan/generationWorkOrders/${index}/sharedAssetLibraryReuse/lookupKey`, errors);
          requireLiteral(workOrder.sharedAssetLibraryReuse.lookupKeySource, "encounter_definition_semantic_requirements", `/plan/generationWorkOrders/${index}/sharedAssetLibraryReuse/lookupKeySource`, errors);
          requireLiteral(workOrder.sharedAssetLibraryReuse.cacheDisposition, "lookup_before_generate", `/plan/generationWorkOrders/${index}/sharedAssetLibraryReuse/cacheDisposition`, errors);
          requireRecord(workOrder.sharedAssetLibraryReuse.sharedLibraryRefs, `/plan/generationWorkOrders/${index}/sharedAssetLibraryReuse/sharedLibraryRefs`, errors);
          requireRecord(workOrder.sharedAssetLibraryReuse.lruCache, `/plan/generationWorkOrders/${index}/sharedAssetLibraryReuse/lruCache`, errors);
          if (isRecord(workOrder.sharedAssetLibraryReuse.sharedLibraryRefs)) {
            requireString(workOrder.sharedAssetLibraryReuse.sharedLibraryRefs.blobPrefix, `/plan/generationWorkOrders/${index}/sharedAssetLibraryReuse/sharedLibraryRefs/blobPrefix`, errors);
            requireLiteral(workOrder.sharedAssetLibraryReuse.sharedLibraryRefs.mongooseCollectionName, "shared_encounter_asset_library", `/plan/generationWorkOrders/${index}/sharedAssetLibraryReuse/sharedLibraryRefs/mongooseCollectionName`, errors);
          }
          if (isRecord(workOrder.sharedAssetLibraryReuse.lruCache)) {
            requireLiteral(workOrder.sharedAssetLibraryReuse.lruCache.enabled, true, `/plan/generationWorkOrders/${index}/sharedAssetLibraryReuse/lruCache/enabled`, errors);
            requireNumber(workOrder.sharedAssetLibraryReuse.lruCache.maxEntries, `/plan/generationWorkOrders/${index}/sharedAssetLibraryReuse/lruCache/maxEntries`, errors);
            requireLiteral(workOrder.sharedAssetLibraryReuse.lruCache.evictionPolicy, "least_recently_used", `/plan/generationWorkOrders/${index}/sharedAssetLibraryReuse/lruCache/evictionPolicy`, errors);
            requireLiteral(workOrder.sharedAssetLibraryReuse.lruCache.reuseRequiresEvidenceGateCompatibility, true, `/plan/generationWorkOrders/${index}/sharedAssetLibraryReuse/lruCache/reuseRequiresEvidenceGateCompatibility`, errors);
            requireLiteral(workOrder.sharedAssetLibraryReuse.lruCache.updateRecencyOnHit, true, `/plan/generationWorkOrders/${index}/sharedAssetLibraryReuse/lruCache/updateRecencyOnHit`, errors);
          }
        }
        requireArray(workOrder.inputRefs, `/plan/generationWorkOrders/${index}/inputRefs`, errors);
        requireArray(workOrder.outputRefs, `/plan/generationWorkOrders/${index}/outputRefs`, errors);
        requireArray(workOrder.evidenceGateRefs, `/plan/generationWorkOrders/${index}/evidenceGateRefs`, errors);
        requireArray(workOrder.visualQaBlockerRefs, `/plan/generationWorkOrders/${index}/visualQaBlockerRefs`, errors);
        requireArray(workOrder.acceptanceCriteria, `/plan/generationWorkOrders/${index}/acceptanceCriteria`, errors);
        for (const notEvidenceFor of ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"]) {
          requireStringArrayIncludes(workOrder.notEvidenceFor, notEvidenceFor, `/plan/generationWorkOrders/${index}/notEvidenceFor`, errors);
        }
        if (
          isRecord(value.caseDefinedHumanoidPerformanceContract)
          && typeof workOrder.actorRole === "string"
          && (workOrder.targetKind === "role_specific_humanoid_glb" || workOrder.targetKind === "role_idle_animation_glb")
        ) {
          validateCaseDefinedHumanoidPerformanceWorkOrderRequirements(
            workOrder.caseDefinedHumanoidPerformanceRequirements,
            `/plan/generationWorkOrders/${index}/caseDefinedHumanoidPerformanceRequirements`,
            errors,
          );
          validateCaseDefinedHumanoidPerformanceWorkOrderConsistency(
            value.caseDefinedHumanoidPerformanceContract,
            workOrder,
            `/plan/generationWorkOrders/${index}/caseDefinedHumanoidPerformanceRequirements`,
            errors,
          );
        }
      });
    }
  }

  if (isRecord(value.operationalNotes)) {
    requireLiteral(value.operationalNotes.longRunningOptimizationAccepted, true, "/operationalNotes/longRunningOptimizationAccepted", errors);
    requireLiteral(value.operationalNotes.mayRunForDays, true, "/operationalNotes/mayRunForDays", errors);
    requireLiteral(value.operationalNotes.generatedAssetsMustRemainDynamic, true, "/operationalNotes/generatedAssetsMustRemainDynamic", errors);
    requireLiteral(value.operationalNotes.sceneIsNotHardcodedInRuntime, true, "/operationalNotes/sceneIsNotHardcodedInRuntime", errors);
    requireRecord(value.operationalNotes.providerDisabledBoundary, "/operationalNotes/providerDisabledBoundary", errors);
    requireRecord(value.operationalNotes.localOnlyBoundary, "/operationalNotes/localOnlyBoundary", errors);
    if (isRecord(value.operationalNotes.providerDisabledBoundary)) {
      requireLiteral(
        value.operationalNotes.providerDisabledBoundary.claimBoundary,
        "provider_gate_metadata_not_live_provider_readiness",
        "/operationalNotes/providerDisabledBoundary/claimBoundary",
        errors,
      );
      requireLiteral(value.operationalNotes.providerDisabledBoundary.executionEnabled, false, "/operationalNotes/providerDisabledBoundary/executionEnabled", errors);
      requireLiteral(
        value.operationalNotes.providerDisabledBoundary.externalProviderExecutionAttempted,
        false,
        "/operationalNotes/providerDisabledBoundary/externalProviderExecutionAttempted",
        errors,
      );
      requireLiteral(value.operationalNotes.providerDisabledBoundary.liveProviderReady, false, "/operationalNotes/providerDisabledBoundary/liveProviderReady", errors);
      requireLiteral(
        value.operationalNotes.providerDisabledBoundary.credentialEvidencePresent,
        false,
        "/operationalNotes/providerDisabledBoundary/credentialEvidencePresent",
        errors,
      );
      requireLiteral(value.operationalNotes.providerDisabledBoundary.runtimeEvidencePresent, false, "/operationalNotes/providerDisabledBoundary/runtimeEvidencePresent", errors);
      requireLiteral(value.operationalNotes.providerDisabledBoundary.reportMetadataOnly, true, "/operationalNotes/providerDisabledBoundary/reportMetadataOnly", errors);
      requireLiteral(value.operationalNotes.providerDisabledBoundary.surfacedInQueueReport, true, "/operationalNotes/providerDisabledBoundary/surfacedInQueueReport", errors);
      requireArray(value.operationalNotes.providerDisabledBoundary.missingEvidenceIds, "/operationalNotes/providerDisabledBoundary/missingEvidenceIds", errors);
      requireArray(value.operationalNotes.providerDisabledBoundary.notEvidenceFor, "/operationalNotes/providerDisabledBoundary/notEvidenceFor", errors);
      for (const missingEvidenceId of providerDisabledBoundaryMissingEvidenceIds) {
        requireStringArrayIncludes(
          value.operationalNotes.providerDisabledBoundary.missingEvidenceIds,
          missingEvidenceId,
          "/operationalNotes/providerDisabledBoundary/missingEvidenceIds",
          errors,
        );
      }
      for (const notEvidenceFor of notEvidenceForAllReadinessClaims) {
        requireStringArrayIncludes(
          value.operationalNotes.providerDisabledBoundary.notEvidenceFor,
          notEvidenceFor,
          "/operationalNotes/providerDisabledBoundary/notEvidenceFor",
          errors,
        );
      }
    }
    if (isRecord(value.operationalNotes.localOnlyBoundary)) {
      requireLiteral(
        value.operationalNotes.localOnlyBoundary.claimBoundary,
        "local_only_asset_pipeline_metadata_not_live_provider_readiness",
        "/operationalNotes/localOnlyBoundary/claimBoundary",
        errors,
      );
      requireLiteral(value.operationalNotes.localOnlyBoundary.executionEnabled, false, "/operationalNotes/localOnlyBoundary/executionEnabled", errors);
      requireLiteral(
        value.operationalNotes.localOnlyBoundary.externalProviderExecutionAttempted,
        false,
        "/operationalNotes/localOnlyBoundary/externalProviderExecutionAttempted",
        errors,
      );
      requireLiteral(value.operationalNotes.localOnlyBoundary.liveProviderReady, false, "/operationalNotes/localOnlyBoundary/liveProviderReady", errors);
      requireLiteral(
        value.operationalNotes.localOnlyBoundary.credentialEvidencePresent,
        false,
        "/operationalNotes/localOnlyBoundary/credentialEvidencePresent",
        errors,
      );
      requireLiteral(value.operationalNotes.localOnlyBoundary.runtimeEvidencePresent, false, "/operationalNotes/localOnlyBoundary/runtimeEvidencePresent", errors);
      requireLiteral(value.operationalNotes.localOnlyBoundary.reportMetadataOnly, true, "/operationalNotes/localOnlyBoundary/reportMetadataOnly", errors);
      requireLiteral(value.operationalNotes.localOnlyBoundary.surfacedInQueueReport, true, "/operationalNotes/localOnlyBoundary/surfacedInQueueReport", errors);
      requireArray(value.operationalNotes.localOnlyBoundary.missingEvidenceIds, "/operationalNotes/localOnlyBoundary/missingEvidenceIds", errors);
      requireArray(value.operationalNotes.localOnlyBoundary.notEvidenceFor, "/operationalNotes/localOnlyBoundary/notEvidenceFor", errors);
      for (const missingEvidenceId of localOnlyBoundaryMissingEvidenceIds) {
        requireStringArrayIncludes(
          value.operationalNotes.localOnlyBoundary.missingEvidenceIds,
          missingEvidenceId,
          "/operationalNotes/localOnlyBoundary/missingEvidenceIds",
          errors,
        );
      }
      for (const notEvidenceFor of notEvidenceForAllReadinessClaims) {
        requireStringArrayIncludes(
          value.operationalNotes.localOnlyBoundary.notEvidenceFor,
          notEvidenceFor,
          "/operationalNotes/localOnlyBoundary/notEvidenceFor",
          errors,
        );
      }
    }
  }

  if (isRecord(value.humanoidRealismRequirements)) {
    requireLiteral(value.humanoidRealismRequirements.schemaVersion, "openclinxr.encounter-humanoid-realism-requirements.v1", "/humanoidRealismRequirements/schemaVersion", errors);
    requireLiteral(value.humanoidRealismRequirements.source, "scenario_actor_definitions", "/humanoidRealismRequirements/source", errors);
    requireArray(value.humanoidRealismRequirements.requirements, "/humanoidRealismRequirements/requirements", errors);
    requireArray(value.humanoidRealismRequirements.notEvidenceFor, "/humanoidRealismRequirements/notEvidenceFor", errors);
    const requirementActorRoleCounts = new Map<string, number>();
    if (Array.isArray(value.humanoidRealismRequirements.requirements)) {
      if (value.humanoidRealismRequirements.requirements.length === 0) {
        errors.push("/humanoidRealismRequirements/requirements must contain at least one actor role");
      }
      value.humanoidRealismRequirements.requirements.forEach((requirement, index) => {
        if (!isRecord(requirement)) {
          errors.push(`/humanoidRealismRequirements/requirements/${index} must be object`);
          return;
        }
        if (typeof requirement.actorRole !== "string" || requirement.actorRole.trim().length === 0) {
          errors.push(`/humanoidRealismRequirements/requirements/${index}/actorRole must be non-empty string`);
          return;
        }
        const normalizedActorRole = normalizeHumanoidActorRole(requirement.actorRole);
        requirementActorRoleCounts.set(normalizedActorRole, (requirementActorRoleCounts.get(normalizedActorRole) ?? 0) + 1);
        if (requirementActorRoleCounts.get(normalizedActorRole)! > 1) {
          errors.push(`/humanoidRealismRequirements/requirements/${index}/actorRole must be unique`);
        }
        if (!isRecord(requirement.realismProfile)) {
          errors.push(`/humanoidRealismRequirements/requirements/${index}/realismProfile must be object`);
        }
        requireStringArrayIncludes(requirement.requiredAssetKinds, "generated_humanoid_mesh", `/humanoidRealismRequirements/requirements/${index}/requiredAssetKinds`, errors);
        requireStringArrayIncludes(requirement.requiredAssetKinds, "clinical_idle_animation", `/humanoidRealismRequirements/requirements/${index}/requiredAssetKinds`, errors);
        requireStringArrayIncludes(requirement.requiredAssetKinds, "viseme_phoneme_map", `/humanoidRealismRequirements/requirements/${index}/requiredAssetKinds`, errors);
        requireStringArrayIncludes(requirement.requiredAssetKinds, "gaze_blink_control", `/humanoidRealismRequirements/requirements/${index}/requiredAssetKinds`, errors);
        requireStringArrayIncludes(requirement.requiredSignalIds, "animated_humanoid_runtime_playback", `/humanoidRealismRequirements/requirements/${index}/requiredSignalIds`, errors);
        requireStringArrayIncludes(requirement.requiredSignalIds, "dialogue_viseme_and_gaze_mapping", `/humanoidRealismRequirements/requirements/${index}/requiredSignalIds`, errors);
        requireStringArrayIncludes(requirement.requiredSignalIds, "dialogue_eye_micro_saccade_blink_cue", `/humanoidRealismRequirements/requirements/${index}/requiredSignalIds`, errors);
        requireStringArrayIncludes(requirement.requiredSignalIds, "generated_eyelid_blink_control_cue", `/humanoidRealismRequirements/requirements/${index}/requiredSignalIds`, errors);
        requireStringArrayIncludes(requirement.requiredSignalIds, "emotion_aligned_expression_transition_cue", `/humanoidRealismRequirements/requirements/${index}/requiredSignalIds`, errors);
        if (isRecord(requirement.realismProfile)) {
          requireLiteral(requirement.realismProfile.claimScope, "metadata_only_not_visual_quality_evidence", `/humanoidRealismRequirements/requirements/${index}/realismProfile/claimScope`, errors);
          requireStringArrayIncludes(requirement.realismProfile.requiredRealismEvidenceIds, "dialogue_viseme_and_gaze_mapping", `/humanoidRealismRequirements/requirements/${index}/realismProfile/requiredRealismEvidenceIds`, errors);
          requireStringArrayIncludes(requirement.realismProfile.requiredRealismEvidenceIds, "dialogue_eye_micro_saccade_blink_cue", `/humanoidRealismRequirements/requirements/${index}/realismProfile/requiredRealismEvidenceIds`, errors);
          requireStringArrayIncludes(requirement.realismProfile.requiredRealismEvidenceIds, "generated_eyelid_blink_control_cue", `/humanoidRealismRequirements/requirements/${index}/realismProfile/requiredRealismEvidenceIds`, errors);
          requireStringArrayIncludes(requirement.realismProfile.requiredRealismEvidenceIds, "emotion_aligned_expression_transition_cue", `/humanoidRealismRequirements/requirements/${index}/realismProfile/requiredRealismEvidenceIds`, errors);
        }
      });
    }
    for (const notEvidenceFor of ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"]) {
      requireStringArrayIncludes(value.humanoidRealismRequirements.notEvidenceFor, notEvidenceFor, "/humanoidRealismRequirements/notEvidenceFor", errors);
    }
  }
  if (Array.isArray(value.humanoidRealismProfiles)) {
    const requirementActorRoles = new Set(
      isRecord(value.humanoidRealismRequirements) && Array.isArray(value.humanoidRealismRequirements.requirements)
        ? value.humanoidRealismRequirements.requirements
          .filter(isRecord)
          .map((requirement) => normalizeHumanoidActorRole(requirement.actorRole))
        : [],
    );
    const profileActorRoleCounts = new Map<string, number>();
    if (
      isRecord(value.humanoidRealismRequirements)
      && Array.isArray(value.humanoidRealismRequirements.requirements)
      && value.humanoidRealismProfiles.length !== value.humanoidRealismRequirements.requirements.length
    ) {
      errors.push("/humanoidRealismProfiles length must match /humanoidRealismRequirements/requirements length");
    }
    value.humanoidRealismProfiles.forEach((profile, index) => {
      if (!isRecord(profile)) {
        errors.push(`/humanoidRealismProfiles/${index} must be object`);
        return;
      }
      requireLiteral(profile.claimScope, "metadata_only_not_visual_quality_evidence", `/humanoidRealismProfiles/${index}/claimScope`, errors);
      if (typeof profile.actorRole !== "string" || profile.actorRole.trim().length === 0) errors.push(`/humanoidRealismProfiles/${index}/actorRole must be non-empty string`);
      const normalizedProfileActorRole = normalizeHumanoidActorRole(profile.actorRole);
      profileActorRoleCounts.set(
        normalizedProfileActorRole,
        (profileActorRoleCounts.get(normalizedProfileActorRole) ?? 0) + 1,
      );
      if (!requirementActorRoles.has(normalizeHumanoidActorRole(profile.actorRole))) {
        errors.push(`/humanoidRealismProfiles/${index}/actorRole must match a humanoid requirement actorRole`);
      }
      requireArray(profile.bodyPostureNotes, `/humanoidRealismProfiles/${index}/bodyPostureNotes`, errors);
      requireArray(profile.clothingClinicalContextCues, `/humanoidRealismProfiles/${index}/clothingClinicalContextCues`, errors);
      requireArray(profile.expressionAffectCues, `/humanoidRealismProfiles/${index}/expressionAffectCues`, errors);
      requireArray(profile.mobilityPositioningConstraints, `/humanoidRealismProfiles/${index}/mobilityPositioningConstraints`, errors);
      requireStringArrayIncludes(profile.requiredRealismEvidenceIds, "dialogue_viseme_and_gaze_mapping", `/humanoidRealismProfiles/${index}/requiredRealismEvidenceIds`, errors);
      requireStringArrayIncludes(profile.requiredRealismEvidenceIds, "dialogue_eye_micro_saccade_blink_cue", `/humanoidRealismProfiles/${index}/requiredRealismEvidenceIds`, errors);
      requireStringArrayIncludes(profile.requiredRealismEvidenceIds, "generated_eyelid_blink_control_cue", `/humanoidRealismProfiles/${index}/requiredRealismEvidenceIds`, errors);
      requireStringArrayIncludes(profile.requiredRealismEvidenceIds, "emotion_aligned_expression_transition_cue", `/humanoidRealismProfiles/${index}/requiredRealismEvidenceIds`, errors);
    });
    if (profileActorRoleCounts.size > 0) {
      for (const actorRole of requirementActorRoles) {
        if ((profileActorRoleCounts.get(actorRole) ?? 0) !== 1) {
          errors.push("/humanoidRealismProfiles actorRole must match each humanoid requirement actorRole exactly once");
          break;
        }
      }
      for (const actorRole of profileActorRoleCounts.keys()) {
        if (!requirementActorRoles.has(actorRole)) {
          errors.push("/humanoidRealismProfiles actorRole must match each humanoid requirement actorRole exactly once");
          break;
        }
      }
    }
  }

  if (isRecord(value.evidenceBoundaries)) {
    requireLiteral(value.evidenceBoundaries.azureQueueMessagePrepared, true, "/evidenceBoundaries/azureQueueMessagePrepared", errors);
    requireLiteral(value.evidenceBoundaries.azureCloudOperationPerformed, false, "/evidenceBoundaries/azureCloudOperationPerformed", errors);
    requireLiteral(value.evidenceBoundaries.paidApisUsed, false, "/evidenceBoundaries/paidApisUsed", errors);
    requireLiteral(value.evidenceBoundaries.productionDeploymentPerformed, false, "/evidenceBoundaries/productionDeploymentPerformed", errors);
    requireLiteral(value.evidenceBoundaries.productionReadinessClaimed, false, "/evidenceBoundaries/productionReadinessClaimed", errors);
    requireLiteral(value.evidenceBoundaries.questReadinessClaimed, false, "/evidenceBoundaries/questReadinessClaimed", errors);
    requireLiteral(value.evidenceBoundaries.clinicalValidityClaimed, false, "/evidenceBoundaries/clinicalValidityClaimed", errors);
    requireLiteral(value.evidenceBoundaries.scoringValidityClaimed, false, "/evidenceBoundaries/scoringValidityClaimed", errors);
  }

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
  } else if (isRecord(value.requiredEnvironment)) {
    requireString(value.requiredEnvironment.environmentId, "/encounterAssetNeedsReadinessManifest/requiredEnvironment/environmentId", errors);
    requireString(value.requiredEnvironment.assetNeedId, "/encounterAssetNeedsReadinessManifest/requiredEnvironment/assetNeedId", errors);
  }
  requireArray(value.requiredPropsAndEquipment, "/encounterAssetNeedsReadinessManifest/requiredPropsAndEquipment", errors);
  if (isRecord(value.animationRequirements)) {
    requireArray(value.animationRequirements.requiredSignalIds, "/encounterAssetNeedsReadinessManifest/animationRequirements/requiredSignalIds", errors);
    requireArray(value.animationRequirements.requiredAssetKinds, "/encounterAssetNeedsReadinessManifest/animationRequirements/requiredAssetKinds", errors);
  } else {
    errors.push("/encounterAssetNeedsReadinessManifest/animationRequirements must be object");
  }
  if (isRecord(value.emotionRequirements)) {
    requireArray(value.emotionRequirements.requiredSignalIds, "/encounterAssetNeedsReadinessManifest/emotionRequirements/requiredSignalIds", errors);
    requireArray(value.emotionRequirements.requiredAssetKinds, "/encounterAssetNeedsReadinessManifest/emotionRequirements/requiredAssetKinds", errors);
  } else {
    errors.push("/encounterAssetNeedsReadinessManifest/emotionRequirements must be object");
  }
  if (isRecord(value.gazeRequirements)) {
    requireArray(value.gazeRequirements.requiredSignalIds, "/encounterAssetNeedsReadinessManifest/gazeRequirements/requiredSignalIds", errors);
    requireArray(value.gazeRequirements.requiredAssetKinds, "/encounterAssetNeedsReadinessManifest/gazeRequirements/requiredAssetKinds", errors);
  } else {
    errors.push("/encounterAssetNeedsReadinessManifest/gazeRequirements must be object");
  }
  if (isRecord(value.lipSyncRequirements)) {
    requireArray(value.lipSyncRequirements.requiredSignalIds, "/encounterAssetNeedsReadinessManifest/lipSyncRequirements/requiredSignalIds", errors);
    requireArray(value.lipSyncRequirements.requiredAssetKinds, "/encounterAssetNeedsReadinessManifest/lipSyncRequirements/requiredAssetKinds", errors);
  } else {
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

function validateCaseDefinedHumanoidPerformanceContract(
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be object`);
    return;
  }
  requireLiteral(
    value.claimBoundary,
    "case_definition_humanoid_performance_metadata_only",
    `${path}/claimBoundary`,
    errors,
  );
  requirePositiveNumber(value.actorCount, `${path}/actorCount`, errors);
  requireArray(value.locomotionActorRoles, `${path}/locomotionActorRoles`, errors);
  requireArray(value.expressionActorRoles, `${path}/expressionActorRoles`, errors);
  requireArray(value.gazeActorRoles, `${path}/gazeActorRoles`, errors);
  requireArray(value.lipSyncActorRoles, `${path}/lipSyncActorRoles`, errors);
  requireArray(value.interactiveActorRoles, `${path}/interactiveActorRoles`, errors);
  requireNonNegativeNumber(value.emotionStateCount, `${path}/emotionStateCount`, errors);
  requireBoolean(value.dialogueDrivenVisemeMappingRequired, `${path}/dialogueDrivenVisemeMappingRequired`, errors);
  requireBoolean(value.gazeTargetingRequired, `${path}/gazeTargetingRequired`, errors);
  requireBoolean(value.locomotionPlanningRequired, `${path}/locomotionPlanningRequired`, errors);
  for (const notEvidenceFor of [
    "generated_humanoid_asset_readiness",
    "animation_quality",
    "quest_readiness",
    "runtime_readiness",
    "clinical_validity",
  ]) {
    requireStringArrayIncludes(value.notEvidenceFor, notEvidenceFor, `${path}/notEvidenceFor`, errors);
  }
}

function validateCaseDefinedHumanoidPerformanceWorkOrderCoverage(
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be object`);
    return;
  }
  requireLiteral(
    value.claimBoundary,
    "case_definition_humanoid_contract_to_work_order_coverage_metadata_only",
    `${path}/claimBoundary`,
    errors,
  );
  requireString(value.scenarioId, `${path}/scenarioId`, errors);
  requireArray(value.actorRoles, `${path}/actorRoles`, errors);
  requireArray(value.actorRoleCoverage, `${path}/actorRoleCoverage`, errors);
  requireArray(value.missingActorRoles, `${path}/missingActorRoles`, errors);
  if (Array.isArray(value.actorRoles) && Array.isArray(value.actorRoleCoverage) && value.actorRoles.length !== value.actorRoleCoverage.length) {
    errors.push(`${path}/actorRoleCoverage length must match ${path}/actorRoles length`);
  }
  if (Array.isArray(value.actorRoleCoverage)) {
    value.actorRoleCoverage.forEach((coverage, index) => {
      if (!isRecord(coverage)) {
        errors.push(`${path}/actorRoleCoverage/${index} must be object`);
        return;
      }
      requireString(coverage.actorRole, `${path}/actorRoleCoverage/${index}/actorRole`, errors);
      if (coverage.humanoidWorkOrderId !== null && typeof coverage.humanoidWorkOrderId !== "string") {
        errors.push(`${path}/actorRoleCoverage/${index}/humanoidWorkOrderId must be string or null`);
      }
      if (coverage.animationWorkOrderId !== null && typeof coverage.animationWorkOrderId !== "string") {
        errors.push(`${path}/actorRoleCoverage/${index}/animationWorkOrderId must be string or null`);
      }
      requireArray(coverage.requiredSignalIds, `${path}/actorRoleCoverage/${index}/requiredSignalIds`, errors);
    });
  }
  for (const notEvidenceFor of [
    "generated_humanoid_asset_readiness",
    "animation_quality",
    "quest_readiness",
    "runtime_readiness",
    "clinical_validity",
  ]) {
    requireStringArrayIncludes(value.notEvidenceFor, notEvidenceFor, `${path}/notEvidenceFor`, errors);
  }
}

function validateCaseDefinedHumanoidPerformanceWorkOrderRequirements(
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be object`);
    return;
  }
  requireLiteral(
    value.claimBoundary,
    "case_definition_humanoid_performance_metadata_only",
    `${path}/claimBoundary`,
    errors,
  );
  requireString(value.actorRole, `${path}/actorRole`, errors);
  requireBoolean(value.locomotionRequired, `${path}/locomotionRequired`, errors);
  requireBoolean(value.expressionRequired, `${path}/expressionRequired`, errors);
  requireBoolean(value.gazeRequired, `${path}/gazeRequired`, errors);
  requireBoolean(value.lipSyncRequired, `${path}/lipSyncRequired`, errors);
  requireBoolean(value.interactiveRequired, `${path}/interactiveRequired`, errors);
  requireBoolean(value.dialogueDrivenVisemeMappingRequired, `${path}/dialogueDrivenVisemeMappingRequired`, errors);
  requireBoolean(value.gazeTargetingRequired, `${path}/gazeTargetingRequired`, errors);
  requireBoolean(value.locomotionPlanningRequired, `${path}/locomotionPlanningRequired`, errors);
  for (const notEvidenceFor of [
    "generated_humanoid_asset_readiness",
    "animation_quality",
    "quest_readiness",
    "runtime_readiness",
    "clinical_validity",
  ]) {
    requireStringArrayIncludes(value.notEvidenceFor, notEvidenceFor, `${path}/notEvidenceFor`, errors);
  }
}

function validateCaseDefinedHumanoidPerformanceWorkOrderConsistency(
  contract: Record<string, unknown>,
  workOrder: Record<string, unknown>,
  path: string,
  errors: string[],
): void {
  if (!isRecord(workOrder.caseDefinedHumanoidPerformanceRequirements) || typeof workOrder.actorRole !== "string") {
    return;
  }
  const actorRole = normalizeHumanoidActorRole(workOrder.actorRole);
  const requirements = workOrder.caseDefinedHumanoidPerformanceRequirements;
  validateContractRoleBoolean(
    contract.locomotionActorRoles,
    actorRole,
    requirements.locomotionRequired,
    `${path}/locomotionRequired`,
    errors,
  );
  validateContractRoleBoolean(
    contract.expressionActorRoles,
    actorRole,
    requirements.expressionRequired,
    `${path}/expressionRequired`,
    errors,
  );
  validateContractRoleBoolean(
    contract.gazeActorRoles,
    actorRole,
    requirements.gazeRequired,
    `${path}/gazeRequired`,
    errors,
  );
  validateContractRoleBoolean(
    contract.lipSyncActorRoles,
    actorRole,
    requirements.lipSyncRequired,
    `${path}/lipSyncRequired`,
    errors,
  );
  validateContractRoleBoolean(
    contract.interactiveActorRoles,
    actorRole,
    requirements.interactiveRequired,
    `${path}/interactiveRequired`,
    errors,
  );
  for (const flag of [
    "dialogueDrivenVisemeMappingRequired",
    "gazeTargetingRequired",
    "locomotionPlanningRequired",
  ]) {
    if (
      typeof contract[flag] === "boolean"
      && typeof requirements[flag] === "boolean"
      && contract[flag] !== requirements[flag]
    ) {
      errors.push(`${path}/${flag} must match /caseDefinedHumanoidPerformanceContract/${flag}`);
    }
  }
}

function validateContractRoleBoolean(
  contractRoles: unknown,
  normalizedActorRole: string,
  actual: unknown,
  path: string,
  errors: string[],
): void {
  if (!Array.isArray(contractRoles) || typeof actual !== "boolean") {
    return;
  }
  const expected = contractRoles.some((role) => normalizeHumanoidActorRole(role) === normalizedActorRole);
  if (actual !== expected) {
    errors.push(`${path} must match /caseDefinedHumanoidPerformanceContract role membership`);
  }
}

export function buildEncounterAssetGenerationRequestForScenario(
  scenarioId: string,
  scenario?: Scenario,
  encounterFactoryInputSummary?: EncounterExecutableAssetGenerationRequest["encounterFactoryInputSummary"],
): EncounterExecutableAssetGenerationRequest {
  const normalizedScenarioId = requireSafeIdentifier(scenarioId, "scenarioId");
  const preset = scenarioPresetById[normalizedScenarioId] ?? {
    encounterId: `${normalizedScenarioId.replace(/_v\d+$/, "")}_encounter_v1`,
    stationId: `${normalizedScenarioId.replace(/_v\d+$/, "")}_station_v1`,
    expectedMinimumHours: 2,
    expectedMaximumHours: 96,
  };

  return {
    requestId: normalizedScenarioId === "ed_chest_pain_priority_v1"
      ? "encounter_assets_ed_chest_pain_executable_v1"
      : `encounter_assets_${normalizedScenarioId.replace(/_v\d+$/, "")}_executable_v1`,
    tenantId: "local_tenant",
    examRunId: `local_exam_run_${normalizedScenarioId}`,
    encounterId: preset.encounterId,
    scenarioId: normalizedScenarioId,
    stationId: preset.stationId,
    ...(encounterFactoryInputSummary ? { encounterFactoryInputSummary } : {}),
    encounterDefinitionRef: {
      storeKind: "mongoose",
      collectionName: "scenario_definitions",
      documentId: `scenario_${normalizedScenarioId}`,
      contentHash: "local-deterministic-encounter-definition-contract",
    },
    targetAssetStore: {
      storeKind: "azurite_blob",
      containerName: "openclinxr-assets",
      blobPrefix: `encounter-assets/local_tenant/${normalizedScenarioId}/${preset.encounterId}/`,
    },
    persistenceTarget: {
      storeKind: "mongoose",
      collectionName: "encounter_asset_generation_jobs",
    },
    requestedStages: [
      "encounter-definition-ingested",
      "character-generation",
      "medical-equipment-generation",
      "environment-generation",
      "animation-generation",
      "voice-asset-generation",
      "asset-bake",
      "scene-manifest-freeze",
      "runtime-bundle-publication",
      "review-evidence-gate",
    ],
    humanoidRealismRequirements: buildHumanoidRealismRequirementsForScenario(normalizedScenarioId, scenario),
    optimizationWindow: {
      expectedMinimumHours: preset.expectedMinimumHours,
      expectedMaximumHours: preset.expectedMaximumHours,
      mayRunForDays: true,
      checkpointIntervalMinutes: 30,
    },
    evidenceGates: {
      requireGeneratedSceneManifest: true,
      requireRuntimeBundlePublication: true,
      requireHumanReviewBeforeLearnerUse: true,
      requireQuestEvidenceBeforeQuestReadinessClaim: true,
    },
    policy: {
      allowPaidCloudApis: false,
      allowProductionDeployment: false,
      productionReadinessClaimed: false,
    },
  };
}

function buildHumanoidRealismRequirementsForScenario(
  scenarioId: string,
  scenario?: Scenario,
): EncounterHumanoidRealismRequirements {
  const actorRolesByScenario: Record<string, string[]> = {
    ed_chest_pain_priority_v1: ["patient", "nurse", "family_member"],
    peds_asthma_parent_anxiety_v1: ["patient", "parent", "clinician"],
    psych_suicidal_ideation_safety_v1: ["patient", "clinician"],
  };
  const actorRoles = resolveEncounterActorRolesForScenario(scenarioId, actorRolesByScenario, scenario);
  return {
    schemaVersion: "openclinxr.encounter-humanoid-realism-requirements.v1",
    source: "scenario_actor_definitions",
    requirements: actorRoles.map((actorRole) => {
      const requiredSignalIds = [...ENCOUNTER_HUMANOID_RUNTIME_REQUIRED_SIGNAL_IDS];
      return {
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
        requiredSignalIds,
        realismProfile: buildHumanoidRealismProfile(actorRole, scenarioId, requiredSignalIds),
      };
    }),
    notEvidenceFor: [
      "production_asset_readiness",
      "quest_readiness",
      "clinical_validity",
      "scoring_validity",
    ],
  };
}

function resolveEncounterActorRolesForScenario(
  scenarioId: string,
  fallbackActorRolesByScenario: Record<string, string[]>,
  scenario?: Scenario,
): string[] {
  const resolvedScenario = scenario ?? findScenarioFixtureById(scenarioId);
  if (!resolvedScenario) {
    return fallbackActorRolesByScenario[scenarioId] ?? ["patient", "clinician"];
  }
  const actorRoles = resolvedScenario.actors
    .map((actor: { role: string }) => actor.role)
    .filter((actorRole: string) => actorRole !== "system");
  return Array.from(new Set(actorRoles));
}

function buildHumanoidRealismProfiles(
  request: EncounterExecutableAssetGenerationRequest,
): EncounterHumanoidRealismProfile[] {
  return (request.humanoidRealismRequirements?.requirements ?? []).map((requirement) => ({
    actorRole: requirement.actorRole,
    ...(requirement.realismProfile ?? buildHumanoidRealismProfile(requirement.actorRole, request.scenarioId, requirement.requiredSignalIds)),
  }));
}

function buildHumanoidRealismProfile(
  actorRole: string,
  scenarioId: string,
  requiredSignalIds: string[],
): Omit<EncounterHumanoidRealismProfile, "actorRole"> {
  return {
    ageBand: actorRole === "patient" && scenarioId.includes("peds_")
      ? "child_or_adolescent"
      : actorRole === "patient"
        ? "adult"
        : "contextual_adult",
    bodyPostureNotes: [
      "role_appropriate_body_scale_and_stance",
      "clinical_idle_pose_must_match_encounter_context",
    ],
    clothingClinicalContextCues: [
      `${actorRole}_role_appropriate_clothing`,
      "clinical_environment_consistent_materials",
    ],
    expressionAffectCues: [
      "dialogue_linked_mouth_eye_expression",
      "subtle_blink_and_micro_saccade_motion",
    ],
    mobilityPositioningConstraints: [
      "initial_pose_from_encounter_definition",
      "movement_must_preserve_clinical_spatial_blocking",
    ],
    requiredRealismEvidenceIds: [...requiredSignalIds],
    claimScope: "metadata_only_not_visual_quality_evidence",
  };
}

function buildDefaultEncounterAssetGenerationRequest(): EncounterExecutableAssetGenerationRequest {
  return buildEncounterAssetGenerationRequestForScenario("ed_chest_pain_priority_v1");
}

const scenarioPresetById: Record<string, {
  encounterId: string;
  stationId: string;
  expectedMinimumHours: number;
  expectedMaximumHours: number;
}> = {
  ed_chest_pain_priority_v1: {
    encounterId: "ed_chest_pain_encounter_v1",
    stationId: "ed_chest_pain_station_v1",
    expectedMinimumHours: 2,
    expectedMaximumHours: 96,
  },
  peds_asthma_parent_anxiety_v1: {
    encounterId: "peds_asthma_parent_anxiety_encounter_v1",
    stationId: "peds_asthma_parent_anxiety_station_v1",
    expectedMinimumHours: 4,
    expectedMaximumHours: 120,
  },
  psych_suicidal_ideation_safety_v1: {
    encounterId: "psych_suicidal_ideation_safety_encounter_v1",
    stationId: "psych_suicidal_ideation_safety_station_v1",
    expectedMinimumHours: 4,
    expectedMaximumHours: 120,
  },
};

function requireSafeIdentifier(value: string, label: string): string {
  if (!/^[a-z0-9_:-]+$/.test(value)) {
    throw new Error(`${label} must contain only lowercase letters, numbers, underscores, colons, or hyphens`);
  }
  return value;
}
function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {
    stdout: false,
    validateLatest: false,
  };

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--output") {
      options.outputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--scenario-id") {
      options.scenarioId = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--projection-artifact") {
      options.projectionArtifactPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--stdout") {
      options.stdout = true;
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
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function requireRecord(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be object`);
  }
}

function requireLiteral(value: unknown, expected: string | number | boolean, path: string, errors: string[]): void {
  if (value !== expected) {
    errors.push(`${path} must be ${JSON.stringify(expected)}`);
  }
}

function requireNumber(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(` must be number`);
  }
}

function requirePositiveNumber(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    errors.push(`${path} must be positive number`);
  }
}

function requireNonNegativeNumber(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    errors.push(`${path} must be non-negative number`);
  }
}

function requireBoolean(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "boolean") {
    errors.push(`${path} must be boolean`);
  }
}

function requireString(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(` must be non-empty string`);
  }
}

function requireArray(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be array`);
  }
}

function requireStringArrayIncludes(value: unknown, expected: string, path: string, errors: string[]): void {
  if (!Array.isArray(value) || !value.includes(expected)) {
    errors.push(`${path} must include ${expected}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeHumanoidActorRole(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}
